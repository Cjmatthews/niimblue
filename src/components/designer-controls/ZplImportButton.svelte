<script lang="ts">
  import type { LabelProps } from "$/types";
  import { FileUtils } from "$/utils/file_utils";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import { tr } from "$/utils/i18n";
  import { Toasts } from "$/utils/toasts";
  import AppModal from "$/components/basic/AppModal.svelte";
  import { addZplObjectsToCanvas, parseZpl } from "$/utils/zpl_import";
  import { canvasToZpl } from "$/utils/zpl_export";
  import type { CustomCanvas } from "$/fabric-object/custom_canvas";

  interface Props {
    labelProps: LabelProps;
    canvas?: CustomCanvas;
    onImageReady: (img: Blob) => void;
    onObjectsImported?: () => void;
  }

  let { labelProps, canvas, onImageReady, onObjectsImported }: Props = $props();
  let importState = $state<"idle" | "processing" | "error">("idle");
  let show = $state(false);
  let zplText = $state("");
  let warnings = $state<string[]>([]);

  const placeholder = `^XA
^FO20,16^A0N,28,28^FDHello NiimBlue^FS
^FO20,52^GB200,4,4^FS
^FO20,70^BQN,2,4^FDQA,https://niim.blue^FS
^XZ`;

  const openModal = () => {
    warnings = [];
    show = true;
  };

  const exportCurrent = () => {
    if (!canvas) {
      Toasts.error("Canvas is not ready");
      return "";
    }

    const result = canvasToZpl(canvas);
    warnings = result.warnings;
    zplText = result.zpl;
    if (canvas.getObjects().length === 0) {
      warnings = [$tr("editor.export.zpl.empty"), ...result.warnings];
    }
    return result.zpl;
  };

  const copyZpl = async () => {
    const source = zplText.trim() ? zplText : exportCurrent();
    if (!source.trim()) return;
    try {
      await navigator.clipboard.writeText(source);
      Toasts.message($tr("editor.export.zpl.copied"));
    } catch (e) {
      Toasts.error(e);
    }
  };

  const downloadZpl = () => {
    const source = zplText.trim() ? zplText : exportCurrent();
    if (!source.trim()) return;
    FileUtils.saveTextFile(`label_${FileUtils.timestamp()}.zpl`, source);
  };

  const loadFromFile = async () => {
    try {
      zplText = await FileUtils.pickAndReadSingleTextFile("zpl");
    } catch (e) {
      Toasts.error(e);
    }
  };

  const importAsObjects = () => {
    if (!canvas) {
      Toasts.error("Canvas is not ready");
      return;
    }

    const source = zplText.trim();
    if (!source) {
      warnings = [$tr("editor.import.zpl.empty")];
      return;
    }

    const result = parseZpl(source);
    warnings = result.warnings;

    if (result.objects.length === 0) {
      return;
    }

    const created = addZplObjectsToCanvas(canvas, result.objects);
    if (created.length === 0) {
      return;
    }

    const overflow = created.some(
      (obj) =>
        (obj.left ?? 0) + (obj.width ?? 0) > canvas.getWidth() || (obj.top ?? 0) + (obj.height ?? 0) > canvas.getHeight(),
    );
    canvas.setActiveObject(created[created.length - 1]!);
    onObjectsImported?.();
    show = false;
    Toasts.message($tr("editor.import.zpl.success").replace("{n}", String(created.length)));
    if (overflow) {
      Toasts.message($tr("editor.import.zpl.overflow"));
    }
  };

  const importAsImage = async () => {
    const source = zplText.trim();
    if (!source) {
      warnings = [$tr("editor.import.zpl.empty")];
      return;
    }

    const mmToInchCoeff = 25.4;
    const dpmm = 8;
    const widthInches = labelProps.size.width / dpmm / mmToInchCoeff;
    const heightInches = labelProps.size.height / dpmm / mmToInchCoeff;

    importState = "processing";

    try {
      const response = await fetch(
        `https://api.labelary.com/v1/printers/${dpmm}dpmm/labels/${widthInches}x${heightInches}/0/`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "image/png",
            "X-Quality": "bitonal",
          },
          body: source,
        },
      );
      if (response.ok) {
        const img = await response.blob();
        onImageReady(img);
        importState = "idle";
        show = false;
      } else {
        importState = "error";
        warnings = [$tr("editor.import.zpl.image_error")];
      }
    } catch (e) {
      importState = "error";
      Toasts.error(e);
    }
  };
</script>

<button class="btn btn-sm" onclick={openModal}>
  <MdIcon icon="code" />
  {$tr("editor.import.zpl")}
</button>

{#if show}
  <AppModal title={$tr("editor.import.zpl.title")} bind:show size="lg">
    <p class="text-secondary small mb-2">{$tr("editor.import.zpl.hint")}</p>
    <textarea
      class="form-control font-monospace zpl-input"
      rows="12"
      placeholder={placeholder}
      bind:value={zplText}></textarea>

    {#if warnings.length > 0}
      <div class="alert alert-warning mt-2 mb-0" role="alert">
        {#each warnings as warning (warning)}
          <div>{warning}</div>
        {/each}
      </div>
    {/if}

    {#snippet footer()}
      <button class="btn btn-secondary" type="button" onclick={loadFromFile}>
        <MdIcon icon="folder_open" />
        {$tr("editor.import.zpl.file")}
      </button>
      <button class="btn btn-secondary" type="button" onclick={exportCurrent}>
        <MdIcon icon="ios_share" />
        {$tr("editor.export.zpl.current")}
      </button>
      <button class="btn btn-secondary" type="button" onclick={copyZpl}>
        <MdIcon icon="content_copy" />
        {$tr("editor.export.zpl.copy")}
      </button>
      <button class="btn btn-secondary" type="button" onclick={downloadZpl}>
        <MdIcon icon="download" />
        {$tr("editor.export.zpl.download")}
      </button>
      <div class="header-spacer"></div>
      <button class="btn btn-secondary" type="button" disabled={importState === "processing"} onclick={importAsImage}>
        <MdIcon icon="image" />
        {#if importState === "processing"}
          <MdIcon icon="hourglass_top" />
        {/if}
        {$tr("editor.import.zpl.image")}
      </button>
      <button class="btn btn-primary" type="button" onclick={importAsObjects}>
        <MdIcon icon="layers" />
        {$tr("editor.import.zpl.objects")}
      </button>
    {/snippet}
  </AppModal>
{/if}

<style>
  .zpl-input {
    font-size: 0.82rem;
    min-height: 220px;
  }
</style>

<script lang="ts">
  import * as fabric from "fabric";
  import { ArUcoMarker } from "$/fabric-object/aruco";
  import { Barcode } from "$/fabric-object/barcode";
  import { QRCode } from "$/fabric-object/qrcode";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import { tr } from "$/utils/i18n";
  import type { MaterialIcon } from "$/styles/mdi_icons";
  import { CustomCanvas } from "$/fabric-object/custom_canvas";

  interface Props {
    canvas: CustomCanvas | undefined;
    selectedObject: fabric.FabricObject | undefined;
    editRevision: number;
    onVisibilityChange?: () => void;
  }

  let { canvas, selectedObject, editRevision, onVisibilityChange }: Props = $props();

  let objects = $derived.by(() => {
    void editRevision;
    const list = canvas?.getObjects() ?? [];
    return [...list].reverse();
  });

  const iconFor = (obj: fabric.FabricObject): MaterialIcon => {
    if (obj instanceof fabric.IText) return "title";
    if (obj instanceof QRCode) return "qr_code_2";
    if (obj instanceof Barcode) return "view_week";
    if (obj instanceof ArUcoMarker) return "grid_on";
    if (obj instanceof fabric.FabricImage) return "image";
    if (obj instanceof fabric.Circle) return "radio_button_unchecked";
    if (obj instanceof fabric.Line) return "remove";
    if (obj instanceof fabric.Rect) return "crop_square";
    return "layers";
  };

  const labelFor = (obj: fabric.FabricObject): string => {
    if (obj instanceof fabric.IText) return obj.text?.trim() || $tr("editor.objectpicker.text");
    if (obj instanceof QRCode) return $tr("editor.objectpicker.qrcode");
    if (obj instanceof Barcode) return $tr("editor.objectpicker.barcode");
    if (obj instanceof ArUcoMarker) return $tr("editor.objectpicker.aruco");
    if (obj instanceof fabric.FabricImage) return $tr("editor.objectpicker.image");
    if (obj instanceof fabric.Circle) return $tr("editor.objectpicker.circle");
    if (obj instanceof fabric.Line) return $tr("editor.objectpicker.line");
    if (obj instanceof fabric.Rect) return $tr("editor.objectpicker.rectangle");
    return obj.type ?? "object";
  };

  let visEpoch = $state(0);

  const selectLayer = (obj: fabric.FabricObject) => {
    if (!canvas) return;
    canvas.setActiveObject(obj);
    canvas.requestRenderAll();
  };

  const toggleVisible = (obj: fabric.FabricObject, e: MouseEvent) => {
    e.stopPropagation();
    obj.set({ visible: obj.visible === false });
    obj.dirty = true;
    canvas?.requestRenderAll();
    visEpoch += 1;
    onVisibilityChange?.();
  };
</script>

<div class="d-flex flex-column gap-1">
  {#if objects.length === 0}
    <div class="text-secondary small">{$tr("ui.layers.empty")}</div>
  {:else}
    {#each objects as obj, i (obj)}
      {@const hidden = visEpoch >= 0 && obj.visible === false}
      <div class="layer-item {selectedObject === obj ? 'active' : ''} {hidden ? 'is-hidden' : ''}">
        <button class="layer-select" type="button" onclick={() => selectLayer(obj)}>
          <MdIcon icon={iconFor(obj)} />
          <span class="text-truncate">{labelFor(obj)}</span>
        </button>
        <span class="layer-index text-secondary small">{objects.length - i}</span>
        <button
          class="layer-vis {hidden ? 'off' : 'on'}"
          type="button"
          title={hidden ? $tr("ui.layers.show") : $tr("ui.layers.hide")}
          onclick={(e) => toggleVisible(obj, e)}>
          <MdIcon icon={hidden ? "visibility_off" : "visibility"} />
        </button>
      </div>
    {/each}
  {/if}
</div>

<style>
  .layer-item.is-hidden .layer-select,
  .layer-item.is-hidden .layer-index {
    color: var(--nb-muted);
    opacity: 0.4;
  }

  .layer-item.is-hidden .layer-select :global(.mdi) {
    color: var(--nb-muted);
  }

  .layer-vis.on :global(.mdi) {
    color: var(--nb-muted);
  }

  .layer-vis.off :global(.mdi) {
    color: var(--nb-muted);
    opacity: 0.35;
  }
</style>


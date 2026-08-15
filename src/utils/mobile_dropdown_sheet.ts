import Dropdown from "bootstrap/js/dist/dropdown";

const MOBILE_MQ = "(max-width: 960px)";

type SheetState = {
  menu: HTMLElement;
  home: Node;
  nextSibling: ChildNode | null;
  backdrop: HTMLElement;
  closeBtn: HTMLButtonElement;
};

const sheets = new WeakMap<HTMLElement, SheetState>();

const isMobile = () => window.matchMedia(MOBILE_MQ).matches;

const findMenu = (toggle: HTMLElement): HTMLElement | null => {
  const wrap = toggle.closest(".dropdown, .dropup, .dropend, .dropstart, .btn-group, .input-group");
  if (!(wrap instanceof HTMLElement)) return null;
  return wrap.querySelector(":scope > .dropdown-menu");
};

const onShow = (e: Event) => {
  const toggle = e.target;
  if (!(toggle instanceof HTMLElement)) return;
  if (!isMobile()) return;
  if (toggle.closest(".dropdown-menu-sheet") || toggle.closest(".modal")) return;

  const menu = findMenu(toggle);
  const home = menu?.parentNode;
  if (!menu || !home) return;

  const instance = Dropdown.getInstance(toggle);
  const backdrop = document.createElement("div");
  backdrop.className = "dropdown-sheet-backdrop";
  backdrop.addEventListener("click", () => instance?.hide());

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "btn-close dropdown-sheet-close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    instance?.hide();
  });

  sheets.set(toggle, {
    menu,
    home,
    nextSibling: menu.nextSibling,
    backdrop,
    closeBtn,
  });

  document.body.append(backdrop, menu);
  menu.classList.add("dropdown-menu-sheet");
  menu.prepend(closeBtn);
};

const onHidden = (e: Event) => {
  const toggle = e.target;
  if (!(toggle instanceof HTMLElement)) return;

  const state = sheets.get(toggle);
  if (!state) return;
  sheets.delete(toggle);

  state.closeBtn.remove();
  state.menu.classList.remove("dropdown-menu-sheet");
  state.home.insertBefore(state.menu, state.nextSibling);
  state.backdrop.remove();
};

export const initMobileDropdownSheets = () => {
  document.addEventListener("show.bs.dropdown", onShow, true);
  document.addEventListener("hidden.bs.dropdown", onHidden, true);

  return () => {
    document.removeEventListener("show.bs.dropdown", onShow, true);
    document.removeEventListener("hidden.bs.dropdown", onHidden, true);
  };
};

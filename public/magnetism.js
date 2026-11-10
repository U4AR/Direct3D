/* Shared Draw3D numeric-control magnetism. Exact typed values are never rewritten. */
(() => {
  function install() {
    if (window.Draw3dMagnetism) return;
    let settings = { enabled: true, numberStep: 5, angleStep: 5, strength: 0.15 },
      dragging = false,
      precise = false;
    const held = new WeakMap();
    const stepFor = (input) => {
      const label = (
        input.getAttribute("aria-label") ||
        input.closest("label")?.textContent ||
        input.name ||
        ""
      ).toLowerCase();
      if (/angle|degree|rotation|yaw|pitch/.test(label)) return settings.angleStep;
      if (/position|origin|plane [xyz] m/.test(label)) return settings.numberStep / 1000;
      if (/scale/.test(label)) return 0.1;
      return settings.numberStep;
    };
    const choose = (value, step) => Math.round(value / step) * step;
    const engine = {
      set(value) {
        settings = { ...settings, ...value };
      },
      get: () => ({ ...settings }),
    };
    window.Draw3dMagnetism = engine;
    const button = document.createElement("button");
    button.type = "button";
    button.hidden = true;
    button.style.cssText =
      "position:fixed;z-index:99999;background:#bdf477;color:#152015;border:1px solid #778c5f;border-radius:5px;padding:5px 9px;font:12px sans-serif";
    document.body.append(button);
    let field, candidate;
    function suggest(input) {
      if (
        !settings.enabled ||
        precise ||
        !input.matches("input[type=number],input[type=text],input:not([type])") ||
        !/^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(input.value.trim())
      ) {
        button.hidden = true;
        return;
      }
      const value = Number(input.value),
        step = stepFor(input),
        next = choose(value, step);
      if (Math.abs(value - next) < 1e-9 || Math.abs(value - next) > step * 0.35) {
        button.hidden = true;
        return;
      }
      field = input;
      candidate = next;
      const r = input.getBoundingClientRect();
      button.textContent = "Use " + Number(next.toFixed(6));
      button.style.left = Math.max(2, Math.min(innerWidth - 100, r.left)) + "px";
      button.style.top = Math.min(innerHeight - 35, r.bottom + 3) + "px";
      button.hidden = false;
    }
    button.addEventListener("pointerdown", (e) => e.preventDefault());
    button.onclick = () => {
      if (!field) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
        field,
        String(Number(candidate.toFixed(9))),
      );
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
      button.hidden = true;
      field.focus();
    };
    document.addEventListener(
      "pointerdown",
      (e) => {
        dragging = e.target instanceof HTMLInputElement && e.target.type === "range";
        precise = e.shiftKey || e.altKey;
      },
      true,
    );
    document.addEventListener("pointerup", () => (dragging = false), true);
    document.addEventListener("keydown", (e) => (precise = e.shiftKey || e.altKey), true);
    document.addEventListener("keyup", (e) => (precise = e.shiftKey || e.altKey), true);
    document.addEventListener(
      "input",
      (e) => {
        const input = e.target;
        if (!(input instanceof HTMLInputElement)) return;
        if (input.type === "range" && dragging && settings.enabled && !precise) {
          const value = Number(input.value),
            step = stepFor(input),
            old = held.get(input),
            anchor =
              old != null && Math.abs(value - old) < step * settings.strength * 1.8
                ? old
                : choose(value, step);
          if (
            Math.abs(value - anchor) <= step * settings.strength ||
            (anchor === old && Math.abs(value - old) < step * settings.strength * 1.8)
          ) {
            const min = Number(input.min || "-Infinity"),
              max = Number(input.max || "Infinity");
            if (anchor >= min && anchor <= max) {
              input.value = String(anchor);
              held.set(input, anchor);
            }
          } else held.delete(input);
        } else suggest(input);
      },
      true,
    );
    document.addEventListener("focusin", (e) => {
      if (e.target instanceof HTMLInputElement) suggest(e.target);
      else if (e.target !== button) button.hidden = true;
    });
    window.addEventListener("message", (e) => {
      if (
        e.origin === location.origin &&
        e.source === parent &&
        e.data?.type === "draw3d-magnetism"
      )
        engine.set(e.data.settings);
    });
  }
  if (document.body) install();
  else document.addEventListener("DOMContentLoaded", install, { once: true });
})();

export function instructionForm(parent, store, onSubmit, prefix) {
  const form = document.createElement("form");
  form.className = "instruction-form";
  form.innerHTML = `<label for="${prefix}-text">Type instructions for the agent</label><textarea id="${prefix}-text" rows="3" maxlength="12000" placeholder="Describe the shape, dimensions, or a change…"></textarea><button type="submit">Save instruction</button><p role="status" class="instruction-status"></p>`;
  parent.append(form);
  const input = form.querySelector("textarea"),
    status = form.querySelector("[role=status]");
  input.value = store.session.instructionDraft || "";
  input.addEventListener("input", () => {
    store.session.instructionDraft = input.value;
    window.dispatchEvent(new Event("draw3d-instruction-draft"));
  });
  window.addEventListener("draw3d-instruction-draft", () => {
    if (document.activeElement !== input) input.value = store.session.instructionDraft || "";
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) {
      status.textContent = "Enter an instruction first.";
      return;
    }
    onSubmit({
      id: crypto.randomUUID(),
      text,
      start: store.elapsed(),
      end: store.elapsed(),
      source: "typed",
    });
    store.session.instructionDraft = "";
    input.value = "";
    window.dispatchEvent(new Event("draw3d-instruction-draft"));
    store.flush().catch((e) => {
      status.textContent = e.message;
    });
    status.textContent = "Saved. Available to the connected agent.";
  });
  return input;
}

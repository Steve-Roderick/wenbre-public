// Deliberately small DOM test fixture. It exercises app behavior, not browser layout,
// CSS, accessibility trees, or native event behavior; those require the manual checks.
export class Node {
  constructor(tag = 'div') {
    this.tagName = tag; this.children = []; this.attributes = {}; this.dataset = {};
    this.className = ''; this.hidden = false; this.disabled = false; this.value = '';
    this.listeners = {}; this._text = ''; this.checked = false; this.parentNode = null;
    this.classList = {
      toggle: (name, force) => {
        const values = new Set(this.className.split(' ').filter(Boolean));
        const add = force ?? !values.has(name);
        if (add) values.add(name); else values.delete(name);
        this.className = [...values].join(' ');
      }
    };
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map((node) => node.textContent).join(''); }
  append(...nodes) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children = []; this._text = ''; this.append(...nodes); }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  async fire(type) { await Promise.all((this.listeners[type] || []).map((fn) => fn({ target: this, preventDefault() {} }))); }
  focus() {}
  showModal() { this.open = true; }
  close() { this.open = false; }
  requestSubmit() { return this.fire('submit'); }
  matches(selector) {
    if (selector.startsWith('.')) return this.className.split(' ').includes(selector.slice(1));
    if (selector.startsWith('[data-')) return selector.slice(6, -1) in this.dataset;
    if (selector === 'input[type=checkbox]') return this.tagName === 'input' && this.type === 'checkbox';
    return this.tagName === selector;
  }
  querySelectorAll(selector) {
    const matches = [];
    for (const child of this.children) {
      if (selector.split(',').some((part) => child.matches(part.trim()))) matches.push(child);
      matches.push(...child.querySelectorAll(selector));
    }
    return matches;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector); }
}
export function makeDocument() {
  const root = new Node('body'); const ids = {};
  for (const id of ['entry','entry-title','entry-message','room','room-title','date-range','locked-in','refresh','last-refreshed',
    'response-picker','response-title','response-options','response-cancel','calendar','calendar-shell','empty','people-count','join-form','name','join','join-hint','notice','notice-message','retry','dismiss','save-status','save-errors','save-error-message','retry-saves']) {
    const node = new Node(id === 'calendar' ? 'table' : id === 'name' ? 'input' : id === 'join-form' ? 'form' : ['refresh','join','retry','dismiss','retry-saves'].includes(id) ? 'button' : 'div');
    ids[id] = node; root.append(node);
  }
  ids['response-picker'].append(ids['response-options']);
  ids.refresh.append(new Node('span'));
  ids.calendar.append(new Node('thead'), new Node('tbody'), new Node('tfoot'));
  return { createElement: (tag) => new Node(tag), getElementById: (id) => ids[id], querySelectorAll: (selector) => root.querySelectorAll(selector), ids };
}

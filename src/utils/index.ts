import { createApp } from 'vue';

export function getDomByVueComponent(component) {
  const div = document.createElement('div');
  const app = createApp(component);
  app.mount(div);
  return div;
}

export function escapeHTML(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export function unescapeHTML(str: string): string {
  const div = document.createElement('div');
  div.innerHTML = str;
  return div.textContent || '';
}

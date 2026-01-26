import createApp from 'Modules/@apostrophecms/ui/lib/vue';

export default function() {
  console.log('fn alive');
  const component = apos.vueComponents.AposChatbot;
  const el = document.createElement('div');
  document.body.appendChild(el);
  const app = createApp(component);
  app.mount(el);
}
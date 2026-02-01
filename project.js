import apostrophe from 'apostrophe';

export default function createApos(options = {}) {
  const baseConfig = {
    root: import.meta,
    shortName: 'public-demo',
    baseUrl: 'http://localhost:3000',

    modules: {
      '@apostrophecms/vite': {},
      '@apostrophecms/asset': {},
      '@apostrophecms/seo': {},
      asset: {},
      helper: {},
      '@apostrophecms/favicon': {},
      '@apostrophecms/open-graph': {},

      // Widgets
      '@apostrophecms/rich-text-widget': {},
      '@apostrophecms/image-widget': {},
      '@apostrophecms/video-widget': {},
      'button-widget': {},
      'github-prs-widget': {},
      'hero-widget': {},
      'card-widget': {},
      'card-title-rt-widget': {
        extend: '@apostrophecms/rich-text-widget',
        options: {
          defaultData: { content: '<h3 class="card__title">My Card Title</h3>' }
        }
      },
      'card-content-rt-widget': {
        extend: '@apostrophecms/rich-text-widget',
        options: {
          defaultData: { content: '<p class="card__text">Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p>' }
        }
      },
      'price-card-widget': {},

      // Pages
      'default-page': {},

      // Pieces - configuration is in modules/article/index.js
      article: {},
      'article-widget': {},
      'article-page': {},
      'article-category': {},

      '@apostrophecms/import-export': {},
      chatbot: {}
    }
  };

  // Deep merge the options
  const mergedConfig = deepMerge(baseConfig, options);

  return apostrophe(mergedConfig);
}

// Deep merge helper
function deepMerge(target, source) {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      if (target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
        result[key] = deepMerge(target[key], source[key]);
      } else {
        result[key] = { ...source[key] };
      }
    } else {
      result[key] = source[key];
    }
  }

  return result;
}

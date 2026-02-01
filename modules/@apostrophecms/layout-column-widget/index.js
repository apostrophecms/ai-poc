import { fullConfig } from '../../../lib/area.js';

export default {
  fields: {
    add: {
      content: {
        type: 'area',
        options: {
          widgets: fullConfig
        }
      }
    }
  },
  methods(self) {
    return {
      // Return a filtered schema for AI, excluding mobile and tablet
      // since they are not commonly used and add noise
      getAiSchema() {
        return self.schema.filter(field => {
          return field.name !== 'mobile' && field.name !== 'tablet';
        });
      }
    };
  }
};

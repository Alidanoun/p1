const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Al Markazia API Documentation',
      version: '1.0.0',
      description: 'Enterprise API documentation for Al Markazia backend services.',
      contact: {
        name: 'Technical Support',
        email: 'support@almarkazia.com'
      }
    },
    servers: [
      {
        url: '/api/v1',
        description: 'Production API (v1)'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        }
      }
    },
    security: [{
      bearerAuth: []
    }]
  },
  apis: ['./src/routes/*.js', './src/controllers/*.js']
};

const specs = swaggerJsdoc(options);

module.exports = {
  swaggerUi,
  specs
};

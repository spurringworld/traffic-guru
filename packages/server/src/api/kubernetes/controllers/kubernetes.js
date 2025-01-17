'use strict';

/**
 * kubernetes controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::kubernetes.kubernetes', {
    async getK8sItems(ctx) {
        try {
          await strapi.service("api::kubernetes.kubernetes").pingK8s(ctx)
          await strapi.service("api::kubernetes.kubernetes").getK8sItems(ctx)
        } catch (error) {
          //ctx.response.body = {status: {running:0, succeeded:0, failed:0}};
          ctx.response.status = 504;
          ctx.response.message = "Unable to connect to kubernetes: " + error.message;
        }
      },
      async getK8sItem(ctx) {
        try {
          await strapi.service("api::kubernetes.kubernetes").pingK8s(ctx)
          await strapi.service("api::kubernetes.kubernetes").getK8sItem(ctx)
        } catch (error) {
          ctx.response.status = 504;
          ctx.response.message = "Unable to connect to kubernetes: " + error.message;
        }
      },
      async getK8sEvent(ctx) {
        try {
          await strapi.service("api::kubernetes.kubernetes").pingK8s(ctx)
          await strapi.service("api::kubernetes.kubernetes").getK8sEvent(ctx)
        } catch (error) {
          ctx.response.status = 504;
          ctx.response.message = "Unable to connect to kubernetes: " + error.message;
        }
      },
      async getK8sLogs(ctx) {
        try {
          await strapi.service("api::kubernetes.kubernetes").pingK8s(ctx)
          await strapi.service("api::kubernetes.kubernetes").getK8sLogs(ctx)
        } catch (error) {
          ctx.response.status = 504;
          ctx.response.message = "Unable to connect to kubernetes: " + error.message;
        }
      },
});

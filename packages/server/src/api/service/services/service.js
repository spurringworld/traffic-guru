'use strict';

/**
 * service service
 */

const { createCoreService } = require('@strapi/strapi').factories;

const k8s = require('@kubernetes/client-node');
const crypto = require('crypto');
const type = 'service';
const kubeUtils = require("../../../functions/kubeUtils.js");

module.exports = createCoreService('api::service.service', {
  async getServices(ctx, args) {
    if (ctx.state.user.role.id != 1 && !args.filters.organization) {
      const orgs = await strapi.db.query("api::organization.organization").findMany({where:{users:{id: {$ne: ctx.state.user.id}}}})
      args.filters["$or"] = [{organization: {id:{$null: true}}}, {organization:{id: {$notIn: orgs.map((o) => o.id)}}}]
    }
    return await kubeUtils.getKubeEntitys(ctx, type, args);
  },
  // eslint-disable-next-line no-unused-vars
  async getAllServices(ctx) {
    // const input = sqlUtils.queryInput(ctx);
    // const { results, pagination } = await super.find(input);
    // results.forEach((result) => {
    //   result.counter = 1;
    // });
    // return { results, pagination };
  },

  async fetchServices(ctx, args, id) {
    if (id) {
      const serv = await strapi.db.query('api::service.service').findOne({ where: { id }, populate: true });
      if (serv) {
        ctx.koaContext.request.header.schema_id = serv.registry.id;
        ctx.koaContext.request.header.namespace = serv.namespace;
      }
    }
    const k8s_cluster_id = ctx.koaContext.request.header.schema_id || '';
    const k8s_cluster_ns = ctx.koaContext.request.header.namespace || '';
    const k8s_cluster_type = ctx.koaContext.request.header.schema_type || '';
    const kc = await strapi.service('api::kubernetes.kubernetes').getKubeConfig(
      k8s_cluster_id,
      k8s_cluster_type
    );
    const k8sApi = kc.makeApiClient(k8s.CoreV1Api);

    let res;
    if (id) {
      const serv = await strapi.db.query('api::service.service').findOne({ where: { id }, populate: true });
      if (serv) {
        res = await k8sApi.readNamespacedService(
          serv.content.metadata.name,
          serv.namespace
        );
      }
      if (!res) {
        await strapi.db.query('api::service.service').update({ where: { id: id }, data: { delete: 1 } });
        return;
      }
      res.body = { items: [res.body] };
    } else if (k8s_cluster_ns && k8s_cluster_ns !== '_all') {
      res = await k8sApi.listNamespacedService(k8s_cluster_ns);
    } else {
      res = await k8sApi.listServiceForAllNamespaces();
    }
    return await kubeUtils.initKubeEntitys(
      ctx,
      type,
      res,
      id
    );
  },
  async fetchAllServices(args, ctx) {
    const registries = await strapi.query('registry').find({ type: 'k8s' });

    for (const registry of registries) {
      const kc = await strapi.service('api::kubernetes.kubernetes').getKubeConfig(
        registry.id,
        'k8s'
      );
      const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
      const res = await k8sApi.listServiceForAllNamespaces();
      ctx.koaContext.request.header.schema_id = registry.id;
      ctx.koaContext.request.header.namespace = '';
      await kubeUtils.initKubeEntitys(ctx, type, res);
    }

    return true;
  },
  async updateServiceSync (args, ctx) {
    const k8s_cluster_id = ctx.koaContext.request.header.schema_id || '';
    const k8s_cluster_type = ctx.koaContext.request.header.schema_type || '';

    if (k8s_cluster_type == 'kubernetes' || k8s_cluster_type == 'k8s') {
      const kc = await strapi.service('api::kubernetes.kubernetes').getKubeConfig(
        k8s_cluster_id,
        k8s_cluster_type
      );
      const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
      try {
        delete args.data.content.metadata.creationTimestamp;
        delete args.data.content.metadata.managedFields;

        await k8sApi.replaceNamespacedService(
          args.data.content.metadata.name,
          args.data.content.metadata.namespace,
          args.data.content
        );
      } catch {
      }
    }
    const serviceDB = await strapi.db
      .query("api::" + type + "." + type)
      .update({ where: { id: args.id }, data: args.data });

    if (k8s_cluster_type == 'kubernetes' || k8s_cluster_type == 'k8s') {
      const kc = await strapi.service('api::kubernetes.kubernetes').getKubeConfig(
        k8s_cluster_id,
        k8s_cluster_type
      );
      const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
      try {
        const service = await k8sApi.readNamespacedService(
          args.data.content.metadata.name,
          args.data.content.metadata.namespace
        );
        const labelSelector =
          Object.keys(service.body.spec.selector)[0] +
          '=' +
          service.body.spec.selector[
          Object.keys(service.body.spec.selector)[0]
          ];
        const pods = await k8sApi.listNamespacedPod(
          args.data.content.metadata.namespace,
          null,
          null,
          null,
          null,
          labelSelector
        );
        for (const pod of pods.body.items) {
          const initContainer =
            pod.spec.initContainers &&
            pod.spec.initContainers.filter((c) => c.name == 'sidecar-init');
          if (!initContainer) {
            await k8sApi.deleteNamespacedPod(
              pod.metadata.name,
              pod.metadata.namespace
            );
          }
        }
      } catch (error) {
        strapi.log.error(error);
      }
    }
    return serviceDB;
  },

  async createServiceSync(ctx) {
    const k8s_cluster_id = ctx.request.body.registry || '';
    const k8s_cluster_type = ctx.koaContext.request.header.schema_type || '';
    const k8s_cluster_ns = ctx.request.body.namespace || '';

    const kc = await strapi.service('api::kubernetes.kubernetes').getKubeConfig(
      k8s_cluster_id,
      k8s_cluster_type
    );
    const k8sApi = kc.makeApiClient(k8s.CoreV1Api);

    try {
      delete ctx.request.body.content.metadata.creationTimestamp;
      delete ctx.request.body.content.metadata.managedFields;
    } catch (error) {
      strapi.log.error(error);
    }

    await k8sApi.createNamespacedService(
      k8s_cluster_ns,
      ctx.request.body.content
    );
    const res = await k8sApi.readNamespacedService(
      ctx.request.body.content.metadata.name,
      ctx.request.body.content.metadata.namespace
    );
    ctx.request.body.content = res.body;
    const ns = await strapi
      .query('namespace')
      .findOne({ registry: k8s_cluster_id, name: k8s_cluster_ns });
    ctx.request.body.ns = ns?.id;
    return await strapi.query(type).create(ctx.request.body);
  },

  async deleteServiceSync (ctx) {
    const k8s_cluster_id = ctx.koaContext.request.header.schema_id || '';
    const k8s_cluster_type = ctx.koaContext.request.header.schema_type || '';

    const kc = await strapi.service('api::kubernetes.kubernetes').getKubeConfig(
      k8s_cluster_id,
      k8s_cluster_type
    );
    const k8sApi = kc.makeApiClient(k8s.CoreV1Api);

    const id = ctx.params.id;
    const values = await strapi.query(type).findOne({ id: id });

    await k8sApi.deleteNamespacedService(
      values.content.metadata.name,
      values.namespace
    );

    return await strapi.query(type).delete({ id: id });
  },

  async deployService() {
    
  },
  async deploySidecar() {
    
  },

  async generateToken (app) {
    if (!app?.content?.identifiers?.jwt?.length) return null;
    try {
      const jwt = {};
      for (const field of app?.content?.identifiers?.jwt[0]?.content?.fields) {
        jwt[field.name] = field.value;
      }
      if (jwt.algorithms == 'HS256') {
        const secret = jwt.secret;
        const header = Buffer.from(JSON.stringify(JSON.parse(jwt.header)))
          .toString('Base64URL')
          .replace(/=+$/gi, '');
        const payload = Buffer.from(JSON.stringify(JSON.parse(jwt.payload)))
          .toString('Base64URL')
          .replace(/=+$/gi, '');
        const hmac = crypto.createHmac('sha256', secret);
        hmac.update(header + '.' + payload);
        let sig = hmac.digest('base64url');
        sig = sig.replace(/=+$/gi, '');
        return header + '.' + payload + '.' + sig;
      }
    } catch (error) {
      strapi.log.error(error);
    }
  },
});

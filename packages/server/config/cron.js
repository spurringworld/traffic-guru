'use strict';

/**
 * Cron config that gives you an opportunity
 * to run scheduled jobs.
 *
 * The cron format consists of:
 * [SECOND (optional)] [MINUTE] [HOUR] [DAY OF MONTH] [MONTH OF YEAR] [DAY OF WEEK]
 *
 */
const k8s = require('@kubernetes/client-node');

async function syncRegistries () {
  if (process.env.DISABLE_SYNCREGISTRIES) return;
  const all = await strapi.db.query('api::registry.registry').findMany();
  for (const data of all) {
    try {
      strapi.service("api::registry.registry").sync(data);
    } catch (err) {
      console.error(err.message);
    }
  }

  const now = new Date();
  await strapi.db.query("api::metric.metric").deleteMany({ where: { createdAt: { $lt: new Date((now.getTime() - (16 * 60 * 1000))) } } })
}

async function syncOsm () {
  if (process.env.DISABLE_SYNCOSM) return;
  try {
    const registries = await strapi.db.query('api::registry.registry').findMany({ where: { type: 'k8s' }, populate: true });
    for (const registry of registries) {
      const kc = await strapi.service('api::kubernetes.kubernetes').getKubeConfig(
        registry.id,
        registry.type
      );
      const k8sApi = kc.makeApiClient(k8s.AppsV1Api);
      const k8sCRDApi = kc.makeApiClient(k8s.CustomObjectsApi);
      const developments = await k8sApi.listDeploymentForAllNamespaces(
        null,
        null,
        'metadata.name=osm-controller',
        'app.kubernetes.io/name=openservicemesh.io'
      );
      for (const item of developments.body.items) {
        const mesh = await strapi.db.query('api::mesh.mesh').findOne({
          where: {
            name: item.metadata.labels.meshName,
            namespace: registry.namespaces.map((n) => n.id),
          }
        });
        if (mesh) continue;
        let ns = await strapi.db
          .query('api::namespace.namespace')
          .findOne({ where: { name: item.metadata.namespace, registry: registry.id } });
        if (!ns) {
          ns = await strapi.db
            .query('api::namespace.namespace')
            .create({ data: { name: item.metadata.namespace, registry: registry.id } });
        }

        const res = await k8sCRDApi.getNamespacedCustomObject(
          'config.openservicemesh.io',
          'v1alpha2',
          item.metadata.namespace,
          'meshconfigs',
          'osm-mesh-config'
        );

        await strapi.db.query('api::mesh.mesh').create({
          data: {
            name: item.metadata.labels.meshName,
            config: res.body,
            namespace: ns.id,
            job: true
          }
        });
      }
      const k8sCoreApi = kc.makeApiClient(k8s.CoreV1Api)
      const allNs = await k8sCoreApi.listNamespace();
      for (const item of allNs.body.items) {
        const meshName = item.metadata.labels["openservicemesh.io/monitored-by"];
        if (!meshName) continue;
        let ns = await strapi.db
          .query('api::namespace.namespace')
          .findOne({ where: { name: item.metadata.name, registry: registry.id }, populate: true});
        if (!ns) {
          ns = await strapi.db
            .query('api::namespace.namespace')
            .create({ data: { name: item.metadata.name, registry: registry.id }, populate: true });
        }

        const mesh = await strapi.db.query('api::mesh.mesh').findOne({
          where: {
            name: meshName,
            namespace: registry.namespaces.map((n) => n.id),
          }, populate: true
        });
        if (!mesh) continue;
        mesh.bindNamespaces = mesh.bindNamespaces.map((n) => n.id)
        if (mesh.bindNamespaces.indexOf(ns.id) == -1) {
          mesh.bindNamespaces.push(ns.id);
          await strapi.db.query('api::mesh.mesh')
          .update({where: {id: mesh.id}, data: {bindNamespaces: mesh.bindNamespaces}})
        }
      }
    }
  } catch (error) {
    console.error(error);
  }
}

module.exports = {
  '40 * * * * *': () => {
    syncOsm()
  },
  '10 * * * * *': () => {
    syncRegistries()
  },
};
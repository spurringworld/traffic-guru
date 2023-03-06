import routerMap from "@/router/async/router.map";
import { mergeI18nFromRoutes } from "@/utils/i18n";
import { createRouter } from "vue-router";
import deepMerge from "deepmerge";
import basicOptions from "@/router/async/config.async";
import { query } from "@/services/graphql";
import _ from "lodash";

let appOptions = {
  router: undefined,
  i18n: undefined,
  store: undefined,
};

function setAppOptions(options) {
  const { router, store, i18n } = options;
  appOptions.router = router;
  appOptions.store = store;
  appOptions.i18n = i18n;
}

async function parseRoutes(routesConfig, routerMap) {
  let routes = [];
  routesConfig.forEach((item) => {
    let router = undefined,
      routeCfg = {};
    if (typeof item === "string") {
      router = routerMap[item];
      routeCfg = { path: router.path || item, router: item };
    } else if (typeof item === "object") {
      router = routerMap[item.router];
      routeCfg = item;
    }
    if (!router) {
      console.warn(
        `can't find register for router ${routeCfg.router}, please register it in advance.`,
      );
      router = typeof item === "string" ? { path: item, name: item } : item;
    }
    const route = {
      path: routeCfg.path || router.path || routeCfg.router,
      name: routeCfg.name || router.name,
      component: router.component,
      redirect: routeCfg.redirect || router.redirect,
      meta: {
        authority:
          routeCfg.authority ||
          router.authority ||
          routeCfg.meta?.authority ||
          router.meta?.authority ||
          "*",
        icon:
          routeCfg.icon ||
          router.icon ||
          routeCfg.meta?.icon ||
          router.meta?.icon,
        page:
          routeCfg.page ||
          router.page ||
          routeCfg.meta?.page ||
          router.meta?.page,
        link:
          routeCfg.link ||
          router.link ||
          routeCfg.meta?.link ||
          router.meta?.link,
      },
    };
    if (routeCfg.invisible || router.invisible) {
      route.meta.invisible = true;
    }
    if (routeCfg.children && routeCfg.children.length > 0) {
      route.children = parseRoutes(routeCfg.children, routerMap);
    }
    if (!routeCfg.disabled) {
      routes.push(route);
    }
  });
  return routes;
}

function loadRoutes(routesConfig) {
  if (arguments.length > 0) {
    const arg0 = arguments[0];
    if (arg0.router || arg0.i18n || arg0.store) {
      routesConfig = arguments[1];
      console.error(
        "the usage of signature loadRoutes({router, store, i18n}, routesConfig) is out of date, please use the new signature: loadRoutes(routesConfig).",
      );
    }
  }
  /*************** version < v0.6.1 *****************/

  const { router, store, i18n } = appOptions;

  if (routesConfig) {
    // store.commit('account/setRoutesConfig', routesConfig);
  } else {
    // routesConfig = store.getters['account/routesConfig'];
  }
  const asyncRoutes = store.state.setting.asyncRoutes;
  if (asyncRoutes) {
    if (routesConfig && routesConfig.length > 0) {
      const routes = parseRoutes(routesConfig, routerMap);
      const finalRoutes = mergeRoutes(basicOptions.routes, routes);
      formatRoutes(finalRoutes);
      router.options = { ...router.options, routes: finalRoutes };
      router.matcher = createRouter({ ...router.options, routes: [] }).matcher;
      router.addRoutes(finalRoutes);
    }
  } else {
    if (routesConfig && routesConfig.initRoutes) {
      routesConfig.routes = _.cloneDeep(routesConfig.initRoutes);
      resetRoutes(routesConfig.routes, router, store, i18n);
    } else {
      setMenuData(router, store, i18n);
    }
  }
}

function setMenuData(router, store, i18n) {
  mergeI18nFromRoutes(i18n, router.options.routes);
  const rootRoute = router.options.routes.find((item) => item.path === "/");
  const menuRoutes = rootRoute && rootRoute.children;
  if (menuRoutes) {
    store.commit("setting/setMenuData", menuRoutes);
  }
}

function mergeRoutes(target, source) {
  const routesMap = {};
  target.forEach((item) => (routesMap[item.path] = item));
  source.forEach((item) => (routesMap[item.path] = item));
  return Object.values(routesMap);
}

function deepMergeRoutes(target, source) {
  const mapRoutes = (routes) => {
    const routesMap = {};
    routes.forEach((item) => {
      routesMap[item.path] = {
        ...item,
        children: item.children ? mapRoutes(item.children) : undefined,
      };
    });
    return routesMap;
  };
  const tarMap = mapRoutes(target);
  const srcMap = mapRoutes(source);

  const merge = deepMerge(tarMap, srcMap);

  const parseRoutesMap = (routesMap) => {
    return Object.values(routesMap).map((item) => {
      if (item.children) {
        item.children = parseRoutesMap(item.children);
      } else {
        delete item.children;
      }
      return item;
    });
  };
  return parseRoutesMap(merge);
}

async function resetRoutes(newRoutes, router, store, i18n) {
  await formatRoutes(newRoutes);
  const oldRoutes = router.getRoutes();
  oldRoutes.forEach((oldRoute) => {
    router.removeRoute(oldRoute.name);
  });
  newRoutes.forEach((newRoute) => {
    router.addRoute(newRoute);
  });
  setMenuData(router, store, i18n);
}

async function formatRoutes(routes) {
  routes.forEach((route) => {
    const { path } = route;
    if (!path.startsWith("/") && path !== "*") {
      route.path = "/" + path;
    }
  });

  // store.commit('setting/setAsyncMenuData', strapiRoutes);
  let strapiRoutes = await getStrapiRoutes();
  formatAuthority(routes, [], strapiRoutes);
  reBuildRoutes({}, routes, 0);
  reSortRoutes(routes, 0);
}

function reBuildRoutes(parents, routes, level) {
  if (routes) {
    for (let index = routes.length - 1; index >= 0; index--) {
      let route = routes[index];

      if (level == 0) {
        if (route.path == "/") {
          reBuildRoutes([route, null], route.children, level + 1);
        }
      } else if (level == 1) {
        if (route.children) {
          reBuildRoutes([route, routes], route.children, level + 1);
        }
      } else {
        if (route.children) {
          reBuildRoutes([route, routes], route.children, level + 1);
        }
        if (route.parent && route.parent.path != parents[0].path) {
          let _move = routes.splice(index, 1);
          parents[1].forEach((newParent) => {
            if (newParent.path == route.parent.path) {
              if (!newParent.children) {
                newParent.children = [];
              }
              newParent.children.push(_move[0]);
            }
          });
        }
      }
    }
  }
}

function reSortRoutes(routes, level) {
  if (routes) {
    routes.forEach((route) => {
      if (level == 0) {
        if (route.path == "/") {
          if (route.children) {
            reSortRoutes(route.children, level + 1);
            route.children.sort((a, b) => a.sort - b.sort);
          }
        }
      } else {
        if (route.children) {
          reSortRoutes(route.children, level + 1);
          route.children.sort((a, b) => a.sort - b.sort);
        }
      }
    });
  }
}

function filterDisabled(routes, strapiRoutes) {
  return routes.filter((route) => {
    let findStrapiRoute = strapiRoutes.find((_sr) => {
      return _sr.path == route.path && _sr.name == route.name;
    });
    if (!route.meta) {
      route.meta = {};
    }
    if (findStrapiRoute) {
      route.meta.disabled = findStrapiRoute.disabled;
      route.sort = findStrapiRoute.sort;
      if (findStrapiRoute.fullPath) {
        route.fullPath = findStrapiRoute.fullPath;
        route.meta.fullPath = findStrapiRoute.fullPath;
      }
      if (findStrapiRoute.displayName) {
        route.displayName = findStrapiRoute.displayName;
        route.meta.displayName = findStrapiRoute.displayName;
      }
      route.parent = findStrapiRoute.parent;
    }
    return !route.meta.disabled;
  });
}

async function getStrapiRoutes() {
  // get strapi async routes
  let strapiRoutes = [];
  await query(
    `routerSettings(sort: "sort:asc", pagination: {limit: 9999 }){data{id,attributes{
			name,
			displayName,
			path,
			fullPath,
			disabled,
			authority,
			invisible,
			sort,
			level,
			parent{data{id,attributes{name,displayName,path,fullPath,disabled,authority,invisible,sort,level}}},
		}}}`
  ).then((res) => {
    strapiRoutes = res.data || [];
  });
  return strapiRoutes;
}

function formatAuthority(routes, pAuthorities = [], strapiRoutes = []) {
  routes.forEach((route) => {
    const meta = route.meta;
    const defaultAuthority = pAuthorities[pAuthorities.length - 1] || {
      permission: "*",
    };
    if (meta) {
      let authority = {};
      if (!meta.authority) {
        authority = defaultAuthority;
      } else if (typeof meta.authority === "string") {
        authority.permission = meta.authority;
      } else if (typeof meta.authority === "object") {
        authority = meta.authority;
        const { role } = authority;
        if (typeof role === "string") {
          authority.role = [role];
        }
        if (!authority.permission && !authority.role) {
          authority = defaultAuthority;
        }
      }
      meta.authority = authority;
    } else {
      const authority = defaultAuthority;
      route.meta = { authority };
    }
    route.meta.pAuthorities = pAuthorities;
    // route.meta.authority = pAuthorities

    if (route.children) {
      route.children = filterDisabled(route.children, strapiRoutes);
      formatAuthority(
        route.children,
        [...pAuthorities, route.meta.authority],
        strapiRoutes,
      );
    }
  });
}

function getI18nKey(path) {
  if (path) {
    const keys = path
      .split("/")
      .filter((item) => !item.startsWith(":") && item != "");
    keys.push("name");
    return keys.join(".");
  } else {
    return "";
  }
}

function loadGuards(guards, options) {
  const { beforeEach, afterEach } = guards;
  const { router } = options;
  beforeEach.forEach((guard) => {
    if (guard && typeof guard === "function") {
      router.beforeEach((to, from, next) => guard(to, from, next, options));
    }
  });
  afterEach.forEach((guard) => {
    if (guard && typeof guard === "function") {
      router.afterEach((to, from) => guard(to, from, options));
    }
  });
}

export {
  parseRoutes,
  loadRoutes,
  formatAuthority,
  getI18nKey,
  loadGuards,
  deepMergeRoutes,
  formatRoutes,
  setAppOptions,
};

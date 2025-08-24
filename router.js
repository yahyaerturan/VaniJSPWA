// router.js - Production Ready Router System for VaniJS
import { vani } from './vanijs.js';

class VaniRouter {
    constructor(vani) {
        this.vani = vani;
        this.routes = {};
        this.history = [];
        this.currentRoute = null;
        this.previousRoute = null;
        this.routerMiddlewares = [];
        this.params = {};
        this.navigationLock = false;
    }

    // Define a route with optional parameters
    defineRoute(path, component, props = {}, middlewares = []) {
        const pattern = path.replace(/:(\w+)/g, '(?<$1>[^/]+)');
        const regex = new RegExp(`^${pattern}$`);
        
        this.routes[path] = {
            originalPath: path,
            pattern: regex,
            component,
            props,
            middlewares,
            params: []
        };

        const paramMatches = path.match(/:(\w+)/g);
        if (paramMatches) {
            this.routes[path].params = paramMatches.map(p => p.substring(1));
        }

        return this;
    }

    // Add global router middleware
    useRouterMiddleware(middleware) {
        this.routerMiddlewares.push(middleware);
        return this;
    }

    // Navigate to a route programmatically
    async navigate(path, replace = false, options = {}) {
        if (this.navigationLock) {
            console.warn('Navigation locked, skipping');
            return;
        }

        if (this.currentRoute === path && !options.force) {
            return;
        }

        this.navigationLock = true;

        try {
            const { route, params } = this.findMatchingRoute(path);
            if (!route) {
                await this.navigate('/404', false, { force: true });
                return;
            }

            // Run router middlewares
            const routerContext = {
                from: this.currentRoute,
                to: path,
                params,
                vani: this.vani,
                redirect: (url) => this.navigate(url, false, { force: true }),
                cancel: () => { throw new Error('Navigation cancelled'); }
            };

            for (const middleware of this.routerMiddlewares) {
                await middleware(routerContext, () => {});
            }

            // Update history
            if (replace && this.history.length > 0) {
                this.history[this.history.length - 1] = path;
            } else {
                this.history.push(path);
            }

            this.currentRoute = path;
            this.params = params;

            // Update URL without triggering hashchange
            const hashChangeHandler = this.vani.routerHandlers?.handleRouteChange;
            if (hashChangeHandler) {
                window.removeEventListener('hashchange', hashChangeHandler);
                window.location.hash = path;
                window.addEventListener('hashchange', hashChangeHandler);
            } else {
                window.location.hash = path;
            }

            if (this.vani.pluginSystem) {
                await this.vani.pluginSystem.executeHook('router:navigation-complete', {
                    from: this.previousRoute,
                    to: path,
                    params,
                    history: [...this.history]
                });
            }

        } catch (error) {
            if (error.message !== 'Navigation cancelled') {
                console.error('Navigation error:', error);
                
                if (this.vani.pluginSystem) {
                    await this.vani.pluginSystem.executeHook('router:navigation-error', {
                        error,
                        path,
                        from: this.currentRoute
                    });
                }
            }
        } finally {
            this.navigationLock = false;
        }
    }

    // Find matching route for a given path
    findMatchingRoute(path) {
        // Exact match first
        if (this.routes[path]) {
            return { route: this.routes[path], params: {} };
        }

        // Parameterized match
        for (const [routePath, route] of Object.entries(this.routes)) {
            const match = path.match(route.pattern);
            if (match) {
                const params = {};
                route.params.forEach(param => {
                    params[param] = match.groups[param];
                });

                return { route, params };
            }
        }

        return { route: null, params: {} };
    }

    // Go back in history
    back() {
        if (this.history.length > 1) {
            this.history.pop();
            const previous = this.history.pop();
            this.navigate(previous || '/');
        } else {
            this.navigate('/');
        }
    }

    // Get current route parameters
    getParam(name) {
        return this.params[name];
    }

    // Get all parameters
    getParams() {
        return { ...this.params };
    }

    // Generate URL from route name and parameters
    generatePath(routePath, params = {}) {
        let generatedPath = routePath;
        
        Object.keys(params).forEach(key => {
            generatedPath = generatedPath.replace(`:${key}`, params[key]);
        });

        return generatedPath;
    }

    // Initialize router
    init(containerId) {
        this.vani.initRouter = (containerId) => this._initRouter(containerId);
        this.vani.navigate = (path, replace) => this.navigate(path, replace);
        this.vani.defineRoute = (path, component, props, middlewares) => 
            this.defineRoute(path, component, props, middlewares);
        
        return this._initRouter(containerId);
    }

    // Internal router initialization
    _initRouter(containerId) {
        const container = document.getElementById(containerId);
        if (!container) {
            console.error(`Container #${containerId} not found`);
            return this;
        }

        this.vani.vdom.rootElement = container;
        
        const handleRouteChange = () => this._handleRoute(container);
        window.addEventListener('hashchange', handleRouteChange);
        window.addEventListener('load', handleRouteChange);
        
        this.vani.routerHandlers = { handleRouteChange };

        if (this.vani.pluginSystem) {
            this.vani.pluginSystem.executeHook('router:init', { containerId });
        }

        return this;
    }

    // Internal route handler with comprehensive plugin integration
    async _handleRoute(container) {
        const startTime = performance.now();
        const path = window.location.hash.replace('#', '') || '/';
        
        if (this.vani.pluginSystem) {
            await this.vani.pluginSystem.executeHook('router:match-start', { path });
        }

        const { route, params } = this.findMatchingRoute(path);
        
        if (this.vani.pluginSystem) {
            await this.vani.pluginSystem.executeHook('router:match-complete', {
                path,
                matchedRoute: route ? route.originalPath : null,
                params
            });
        }

        // Handle 404 if no route found
        if (!route) {
            const notFoundContext = { 
                path, 
                vani: this.vani,
                redirect: (url) => this.navigate(url)
            };

            if (this.vani.pluginSystem) {
                await this.vani.pluginSystem.executeHook('router:not-found', notFoundContext);
            }

            if (this.routes['/404']) {
                const element = await this.vani.renderComponent(
                    this.routes['/404'].component, 
                    { ...this.routes['/404'].props, path }
                );
                this.vani.render(element, container);
            } else {
                container.innerHTML = '<h2>404 - Page Not Found</h2>';
            }

            if (this.vani.pluginSystem) {
                await this.vani.pluginSystem.executeHook('router:not-found-rendered', {
                    path,
                    container
                });
            }
            return;
        }

        const routeContext = { 
            path, 
            route: route.originalPath,
            params,
            vani: this.vani,
            redirect: (url) => this.navigate(url),
            cancel: () => { throw new Error('Navigation cancelled by middleware'); },
            startTime
        };

        if (this.vani.pluginSystem) {
            await this.vani.pluginSystem.executeHook('router:context-created', routeContext);
        }

        try {
            // Run route-specific middlewares
            for (const middleware of route.middlewares) {
                if (this.vani.pluginSystem) {
                    await this.vani.pluginSystem.executeHook('router:middleware-before', {
                        middleware,
                        context: routeContext
                    });
                }

                await middleware(routeContext, () => {});

                if (this.vani.pluginSystem) {
                    await this.vani.pluginSystem.executeHook('router:middleware-after', {
                        middleware,
                        context: routeContext
                    });
                }
            }

            // Run global router middlewares
            for (const middleware of this.routerMiddlewares) {
                if (this.vani.pluginSystem) {
                    await this.vani.pluginSystem.executeHook('router:global-middleware-before', {
                        middleware,
                        context: routeContext
                    });
                }

                await middleware(routeContext, () => {});

                if (this.vani.pluginSystem) {
                    await this.vani.pluginSystem.executeHook('router:global-middleware-after', {
                        middleware,
                        context: routeContext
                    });
                }
            }

            if (this.vani.pluginSystem) {
                await this.vani.pluginSystem.executeHook('router:before-render', {
                    context: routeContext,
                    component: route.component
                });
            }

            const element = await this.vani.renderComponent(route.component, { 
                ...route.props, 
                params,
                route: route.originalPath,
                path
            });
            
            if (this.vani.pluginSystem) {
                await this.vani.pluginSystem.executeHook('router:before-dom-update', {
                    context: routeContext,
                    element,
                    container
                });
            }

            this.vani.render(element, container);
            
            this.currentRoute = path;
            this.params = params;

            const duration = performance.now() - startTime;
            
            if (this.vani.pluginSystem) {
                await this.vani.pluginSystem.executeHook('router:complete', {
                    context: routeContext,
                    element,
                    container,
                    duration
                });
            }

            if (this.vani.pluginSystem) {
                await this.vani.pluginSystem.executeHook('route:change', {
                    from: this.previousRoute,
                    to: path,
                    params,
                    duration
                });
            }

            this.previousRoute = path;

        } catch (error) {
            console.error('Route handling error:', error);
            
            if (this.vani.pluginSystem) {
                await this.vani.pluginSystem.executeHook('router:error', {
                    error,
                    context: routeContext,
                    path
                });
            }

            if (this.routes['/500']) {
                const errorElement = await this.vani.renderComponent(
                    this.routes['/500'].component, 
                    { ...this.routes['/500'].props, error, path }
                );
                this.vani.render(errorElement, container);
            } else {
                const esc = (s) => String(s).replace(/[&<>"'`=\/]/g,
                    c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#x2F;','`':'&#x60;','=':'&#x3D;'}[c]));
                container.innerHTML = `
                    <div class="error-page">
                        <h2>500 - Application Error</h2>
                        <p>${esc(error?.message || 'Unexpected error')}</p>
                        <button onclick="window.location.reload()">Reload Page</button>
                    </div>
                `;
            }
        }
    }

    // Get navigation history
    getHistory() {
        return [...this.history];
    }

    // Clear navigation history
    clearHistory() {
        this.history = [];
    }

    // Get route by path
    getRoute(path) {
        return this.routes[path];
    }

    // Get all routes
    getAllRoutes() {
        return { ...this.routes };
    }

    // Check if route exists
    hasRoute(path) {
        return !!this.routes[path];
    }

    // Navigation lock control
    setNavigationLock(locked) {
        this.navigationLock = locked;
    }

    // Destroy router
    destroy() {
        if (this.vani.routerHandlers) {
            window.removeEventListener('hashchange', this.vani.routerHandlers.handleRouteChange);
            window.removeEventListener('load', this.vani.routerHandlers.handleRouteChange);
        }
        
        if (this.vani.pluginSystem) {
            this.vani.pluginSystem.executeHook('router:destroy');
        }
        
        console.log('VaniRouter destroyed');
    }
}

// Initialize and export router
const vaniRouter = new VaniRouter(vani);
vani.router = vaniRouter;

export { VaniRouter, vaniRouter };
export default vaniRouter;
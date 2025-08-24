// vanijs.js - Production Ready VaniJS Framework
class VaniJS {
    constructor() {
        // Core framework properties
        this.routes = {};
        this.components = {};
        this.state = {};
        this.currentComponent = null;
        this.i18n = {};
        this.currentLanguage = 'en';
        this.middlewares = [];
        this.plugins = {};
        this.vdom = {
            currentTree: null,
            rootElement: null
        };
        
        // Plugin system integration
        this.pluginSystem = null;
        
        // Router integration
        this.router = null;
        this.routerHandlers = null;
        this.navigate = null;
        
        // Initialize core systems
        this.auth = this.createAuthSystem();
        this.permissions = this.createPermissionSystem();
        
        // Performance monitoring
        this.performance = {
            metrics: new Map(),
            startTime: Date.now()
        };
    }

    // ==================== CORE FRAMEWORK METHODS ====================

    // Middleware system
    use(middleware) {
        if (typeof middleware === 'function') {
            this.middlewares.push(middleware);
        }
        return this;
    }

    async runMiddlewares(context) {
        for (const middleware of this.middlewares) {
            try {
                await middleware(context, () => {});
            } catch (error) {
                console.error('Middleware error:', error);
                if (this.pluginSystem) {
                    this.pluginSystem.executeHook('middleware:error', { error, middleware, context });
                }
                break;
            }
        }
    }

    // Plugin system (legacy)
    registerPlugin(name, plugin) {
        this.plugins[name] = plugin;
        if (plugin.init && typeof plugin.init === 'function') {
            plugin.init(this);
        }
        return this;
    }

    getPlugin(name) {
        return this.plugins[name];
    }

    // Virtual DOM system
    createElement(tag, props = {}, ...children) {
        return {
            tag,
            props: props || {},
            children: children.flat(Infinity).filter(child => 
                child != null && child !== false && child !== true
            ),
            key: props?.key,
            type: typeof tag === 'function' ? 'component' : 'element'
        };
    }

    render(vnode, container) {
        if (!container) {
            console.error('Container not provided for render');
            return;
        }

        const startTime = performance.now();
        
        if (this.vdom.currentTree) {
            this.patch(container, this.vdom.currentTree, vnode);
        } else {
            container.innerHTML = '';
            const dom = this.createDOM(vnode);
            container.appendChild(dom);
        }
        
        this.vdom.currentTree = vnode;
        this.vdom.rootElement = container;

        const renderTime = performance.now() - startTime;
        if (this.pluginSystem) {
            this.pluginSystem.executeHook('render:complete', { renderTime, vnode, container });
        }
    }

    createDOM(vnode) {
        if (typeof vnode === 'string' || typeof vnode === 'number') {
            return document.createTextNode(String(vnode));
        }

        if (typeof vnode === 'boolean' || vnode == null) {
            return document.createTextNode('');
        }

        if (typeof vnode.tag === 'function') {
            const componentResult = vnode.tag(vnode.props);
            return this.createDOM(componentResult);
        }

        const element = document.createElement(vnode.tag);

        // Set properties
        Object.keys(vnode.props).forEach(key => {
            if (key.startsWith('on') && typeof vnode.props[key] === 'function') {
                const eventType = key.toLowerCase().substring(2);
                element.addEventListener(eventType, vnode.props[key]);
            } else if (key === 'className') {
                element.className = vnode.props[key];
            } else if (key === 'style' && typeof vnode.props[key] === 'object') {
                Object.assign(element.style, vnode.props[key]);
            } else if (key !== 'key' && key !== 'children') {
                element.setAttribute(key, vnode.props[key]);
            }
        });

        // Render children
        vnode.children.forEach(child => {
            const childDOM = this.createDOM(child);
            if (childDOM) {
                element.appendChild(childDOM);
            }
        });

        return element;
    }

    patch(parent, oldVNode, newVNode) {
        if (!oldVNode && !newVNode) return;
        
        if (!oldVNode) {
            const newDOM = this.createDOM(newVNode);
            parent.appendChild(newDOM);
            return;
        }

        if (!newVNode) {
            if (parent.firstChild) {
                parent.removeChild(parent.firstChild);
            }
            return;
        }

        if (this.isVNodeChanged(oldVNode, newVNode)) {
            const newDOM = this.createDOM(newVNode);
            parent.replaceChild(newDOM, parent.firstChild);
            return;
        }

        if (typeof newVNode === 'object' && newVNode.tag) {
            this.updateProperties(parent.firstChild, oldVNode.props, newVNode.props);
            
            const oldChildren = oldVNode.children || [];
            const newChildren = newVNode.children || [];
            const maxLength = Math.max(oldChildren.length, newChildren.length);
            
            for (let i = 0; i < maxLength; i++) {
                this.patch(parent.firstChild, oldChildren[i], newChildren[i]);
            }
        }
    }

    isVNodeChanged(oldVNode, newVNode) {
        if (typeof oldVNode !== typeof newVNode) return true;
        if (typeof oldVNode === 'string') return oldVNode !== newVNode;
        if (typeof oldVNode === 'number') return oldVNode !== newVNode;
        if (oldVNode.tag !== newVNode.tag) return true;
        if (oldVNode.key !== newVNode.key) return true;
        return false;
    }

    updateProperties(element, oldProps, newProps) {
        if (!element) return;

        const allProps = { ...oldProps, ...newProps };
        
        Object.keys(allProps).forEach(key => {
            const oldValue = oldProps[key];
            const newValue = newProps[key];
            
            if (newValue === undefined || newValue === null) {
                if (key.startsWith('on')) {
                    const eventType = key.toLowerCase().substring(2);
                    element.removeEventListener(eventType, oldValue);
                } else if (key === 'className') {
                    element.className = '';
                } else if (key === 'style') {
                    element.style = {};
                } else {
                    element.removeAttribute(key);
                }
            } else if (oldValue !== newValue) {
                if (key.startsWith('on') && typeof newValue === 'function') {
                    const eventType = key.toLowerCase().substring(2);
                    if (oldValue) {
                        element.removeEventListener(eventType, oldValue);
                    }
                    element.addEventListener(eventType, newValue);
                } else if (key === 'className') {
                    element.className = newValue;
                } else if (key === 'style' && typeof newValue === 'object') {
                    Object.assign(element.style, newValue);
                } else if (key !== 'key') {
                    element.setAttribute(key, newValue);
                }
            }
        });
    }

    // Component system
    defineComponent(name, componentFunction) {
        this.components[name] = componentFunction;
        return this;
    }

    async renderComponent(name, props = {}) {
        const startTime = performance.now();
        this.currentComponent = name;
        const componentFunction = this.components[name];
        
        if (!componentFunction) {
            console.error(`Component ${name} not found`);
            return this.createElement('div', { className: 'error' }, `Component ${name} not found`);
        }

        const context = {
            props,
            t: (key, params) => this.translate(key, params),
            hasPermission: (perm) => this.checkPermission(perm),
            isAuthenticated: () => this.isAuthenticated(),
            vani: this
        };

        try {
            await this.runMiddlewares(context);
            const result = componentFunction(context);
            
            const renderTime = performance.now() - startTime;
            if (this.pluginSystem) {
                this.pluginSystem.executeHook('component:render', { 
                    name, 
                    renderTime, 
                    props 
                });
            }
            
            return result;
        } catch (error) {
            console.error(`Error rendering component ${name}:`, error);
            
            if (this.pluginSystem) {
                this.pluginSystem.executeHook('component:error', { 
                    name, 
                    error, 
                    props 
                });
            }
            
            return this.createElement('div', { className: 'error' }, 
                `Error rendering ${name}: ${error.message}`
            );
        }
    }

    // State management
    useState(initialState) {
        const componentName = this.currentComponent;
        if (!componentName) {
            throw new Error('useState must be called within a component');
        }

        const stateKey = `${componentName}_state`;
        
        if (!this.state[stateKey]) {
            this.state[stateKey] = typeof initialState === 'function' 
                ? initialState() 
                : initialState;
            
            if (this.pluginSystem) {
                this.pluginSystem.executeHook('state:create', stateKey, this.state[stateKey]);
            }
            
            Object.values(this.plugins).forEach(plugin => {
                if (plugin.onStateCreate) {
                    plugin.onStateCreate(stateKey, this.state[stateKey]);
                }
            });
        }

        const setState = (newState) => {
            const oldState = this.state[stateKey];
            this.state[stateKey] = typeof newState === 'function'
                ? newState(oldState)
                : { ...oldState, ...newState };
            
            if (this.pluginSystem) {
                this.pluginSystem.executeHook('state:update', stateKey, oldState, this.state[stateKey]);
            }
            
            Object.values(this.plugins).forEach(plugin => {
                if (plugin.onStateUpdate) {
                    plugin.onStateUpdate(stateKey, oldState, this.state[stateKey]);
                }
            });

            if (this.currentComponent) {
                this.updateComponent(this.currentComponent);
            }
        };

        return [this.state[stateKey], setState];
    }

    updateComponent(componentName) {
        if (this.vdom.rootElement && this.currentComponent === componentName) {
            this.handleRoute(this.vdom.rootElement);
        }
    }

    // ==================== AUTHENTICATION SYSTEM ====================

    createAuthSystem() {
        return {
            user: null,
            tokens: null,
            
            login: async (credentials) => {
                try {
                    const response = await fetch('/api/login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(credentials)
                    });
                    
                    if (response.ok) {
                        const data = await response.json();
                        this.auth.user = data.user;
                        this.auth.tokens = data.tokens;
                        localStorage.setItem('auth', JSON.stringify(data));
                        
                        if (this.auth.user) {
                            const perms = this.auth.user.role === 'admin' 
                                ? ['read', 'write', 'delete', 'admin'] 
                                : ['read', 'write'];
                            this.permissions.setPermissions(perms);
                        }
                        
                        if (this.pluginSystem) {
                            this.pluginSystem.executeHook('auth:login', this.auth.user);
                        }
                        
                        return true;
                    }
                    return false;
                } catch (error) {
                    console.error('Login failed:', error);
                    
                    if (this.pluginSystem) {
                        this.pluginSystem.executeHook('auth:login-failed', error);
                    }
                    
                    return false;
                }
            },

            logout: () => {
                const oldUser = this.auth.user;
                this.auth.user = null;
                this.auth.tokens = null;
                this.permissions.setPermissions([]);
                localStorage.removeItem('auth');
                
                if (this.pluginSystem) {
                    this.pluginSystem.executeHook('auth:logout', oldUser);
                }
            },

            init: () => {
                try {
                    const savedAuth = localStorage.getItem('auth');
                    if (savedAuth) {
                        const data = JSON.parse(savedAuth);
                        this.auth.user = data.user;
                        this.auth.tokens = data.tokens;
                        
                        if (this.pluginSystem) {
                            this.pluginSystem.executeHook('auth:init', this.auth.user);
                        }
                    }
                } catch (error) {
                    console.error('Auth init failed:', error);
                    
                    if (this.pluginSystem) {
                        this.pluginSystem.executeHook('auth:init-failed', error);
                    }
                }
            }
        };
    }

    isAuthenticated() {
        return !!this.auth.user;
    }

    // ==================== PERMISSION SYSTEM ====================

    createPermissionSystem() {
        return {
            userPermissions: [],
            
            setPermissions: (perms) => {
                const oldPermissions = this.permissions.userPermissions;
                this.permissions.userPermissions = perms;
                
                if (this.pluginSystem) {
                    this.pluginSystem.executeHook('permissions:change', oldPermissions, perms);
                }
            },
            
            hasPermission: (requiredPerm) => {
                return this.permissions.userPermissions.includes(requiredPerm) || 
                       this.permissions.userPermissions.includes('admin');
            }
        };
    }

    checkPermission(perm) {
        return this.permissions.hasPermission(perm);
    }

    // ==================== INTERNATIONALIZATION ====================

    setTranslations(lang, translations) {
        this.i18n[lang] = translations;
        return this;
    }

    setLanguage(lang) {
        if (this.i18n[lang]) {
            this.currentLanguage = lang;
            localStorage.setItem('preferredLanguage', lang);
            
            if (this.vdom.rootElement) {
                this.handleRoute(this.vdom.rootElement);
            }
            
            if (this.pluginSystem) {
                this.pluginSystem.executeHook('i18n:change', lang);
            }
        }
        return this;
    }

    translate(key, params = {}) {
        let translation = this.i18n[this.currentLanguage]?.[key] || key;
        
        Object.keys(params).forEach(param => {
            translation = translation.replace(`{${param}}`, params[param]);
        });
        
        return translation;
    }

    initI18n() {
        const savedLang = localStorage.getItem('preferredLanguage');
        if (savedLang && this.i18n[savedLang]) {
            this.currentLanguage = savedLang;
        }
    }

    // ==================== FRAMEWORK INITIALIZATION ====================

    init() {
        this.auth.init();
        this.initI18n();
        
        if (this.auth.user) {
            const perms = this.auth.user.role === 'admin' 
                ? ['read', 'write', 'delete', 'admin'] 
                : ['read', 'write'];
            this.permissions.setPermissions(perms);
        }

        Object.values(this.plugins).forEach(plugin => {
            if (plugin.init && typeof plugin.init === 'function') {
                plugin.init(this);
            }
        });

        if (this.pluginSystem) {
            this.pluginSystem.executeHook('app:init', this);
        }

        console.log('VaniJS framework initialized');
        return this;
    }

    // ==================== UTILITY METHODS ====================

    handleRoute(container) {
        if (this.router && typeof this.router._handleRoute === 'function') {
            this.router._handleRoute(container);
        } else {
            console.error('Router not initialized');
        }
    }

    destroy() {
        if (this.routerHandlers) {
            window.removeEventListener('hashchange', this.routerHandlers.handleRouteChange);
            window.removeEventListener('load', this.routerHandlers.handleRouteChange);
        }
        
        if (this.pluginSystem) {
            this.pluginSystem.executeHook('app:destroy', this);
        }

        console.log('VaniJS framework destroyed');
    }

    // Configuration helpers
    getConfig(name, key, defaultValue = null) {
        if (this.pluginSystem && typeof this.pluginSystem.getConfig === 'function') {
            return this.pluginSystem.getConfig(name, key, defaultValue);
        }
        const configKey = `vani:${name}:${key}`;
        try {
            const item = localStorage.getItem(configKey);
            return item ? JSON.parse(item) : defaultValue;
        } catch {
            return defaultValue;
        }
    }

    setConfig(name, key, value) {
        if (this.pluginSystem && typeof this.pluginSystem.setConfig === 'function') {
            return this.pluginSystem.setConfig(name, key, value);
        }
        const configKey = `vani:${name}:${key}`;
        try {
            localStorage.setItem(configKey, JSON.stringify(value));
            return true;
        } catch {
            return false;
        }
    }

    // Performance monitoring
    recordMetric(name, value, metadata = {}) {
        const metric = {
            name,
            value,
            timestamp: Date.now(),
            ...metadata
        };

        this.performance.metrics.set(name, metric);
        
        if (this.pluginSystem) {
            this.pluginSystem.executeHook('performance:metric', metric);
        }
    }

    getMetrics() {
        return Array.from(this.performance.metrics.values());
    }

    clearMetrics() {
        this.performance.metrics.clear();
    }
}

// Global instance and shorthand functions
const vani = new VaniJS();
const { createElement, defineComponent, defineRoute, useState, use, registerPlugin } = vani;
window.vani = vani;

// Shorthand for createElement
function h(tag, props, ...children) {
    return vani.createElement(tag, props, ...children);
}

export { VaniJS, vani, h };
export default vani;
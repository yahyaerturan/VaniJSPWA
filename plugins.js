// plugin.js - Production Ready Plugin System for VaniJS
import { vani } from './vanijs.js';

// ==================== CORE PLUGIN SYSTEM ====================
class VaniPluginSystem {
    constructor(vani) {
        this.vani = vani;
        this.plugins = new Map();
        this.hooks = new Map();
        this.pluginStates = new Map();
        this.dependencies = new Map();
        this.pluginLoadOrder = [];
        this.initialized = false;
    }

    // Register a plugin with optional dependencies
    register(name, plugin, options = {}) {
        if (this.plugins.has(name)) {
            console.warn(`Plugin "${name}" is already registered`);
            return false;
        }

        // Check dependencies
        if (options.dependencies) {
            const missingDeps = options.dependencies.filter(dep => !this.plugins.has(dep));
            if (missingDeps.length > 0) {
                console.error(`Plugin "${name}" missing dependencies: ${missingDeps.join(', ')}`);
                return false;
            }
            this.dependencies.set(name, options.dependencies);
        }

        try {
            this.plugins.set(name, {
                instance: plugin,
                options,
                enabled: true,
                version: options.version || '1.0.0'
            });

            this.pluginStates.set(name, {
                status: 'registered',
                loadTime: Date.now(),
                error: null
            });

            console.log(`✅ Plugin "${name}" registered successfully`);

            // Auto-initialize if system is already initialized
            if (this.initialized && options.autoInit !== false) {
                this.initializePlugin(name);
            }

            return true;
        } catch (error) {
            console.error(`❌ Failed to register plugin "${name}":`, error);
            this.pluginStates.set(name, {
                status: 'error',
                loadTime: Date.now(),
                error: error.message
            });
            return false;
        }
    }

    // Initialize a specific plugin
    initializePlugin(name) {
        const pluginInfo = this.plugins.get(name);
        if (!pluginInfo || !pluginInfo.enabled) {
            return false;
        }

        try {
            const plugin = pluginInfo.instance;
            
            // Initialize plugin
            if (plugin.init && typeof plugin.init === 'function') {
                plugin.init(this.vani, this, pluginInfo.options);
            }

            // Register hooks
            if (plugin.hooks) {
                this.registerHooks(name, plugin.hooks);
            }

            // Register commands if available
            if (plugin.commands) {
                this.registerCommands(name, plugin.commands);
            }

            this.pluginStates.set(name, {
                ...this.pluginStates.get(name),
                status: 'initialized',
                initTime: Date.now()
            });

            console.log(`✅ Plugin "${name}" initialized successfully`);
            
            // Execute post-init hook
            this.executeHook('plugin:initialized', { name, plugin });
            
            return true;
        } catch (error) {
            console.error(`❌ Failed to initialize plugin "${name}":`, error);
            this.pluginStates.set(name, {
                ...this.pluginStates.get(name),
                status: 'error',
                error: error.message
            });
            
            this.executeHook('plugin:init-failed', { name, error });
            return false;
        }
    }

    // Initialize all plugins in proper order
    initializeAll() {
        if (this.initialized) {
            console.warn('Plugin system already initialized');
            return;
        }

        // Determine load order based on dependencies
        this.determineLoadOrder();

        // Initialize plugins in order
        for (const name of this.pluginLoadOrder) {
            this.initializePlugin(name);
        }

        this.initialized = true;
        console.log('✅ All plugins initialized');
        this.executeHook('plugin-system:initialized');
    }

    // Determine plugin load order based on dependencies
    determineLoadOrder() {
        const visited = new Set();
        const temp = new Set();
        const order = [];

        const visit = (name) => {
            if (temp.has(name)) {
                throw new Error(`Circular dependency detected involving plugin: ${name}`);
            }
            
            if (!visited.has(name)) {
                temp.add(name);
                
                const deps = this.dependencies.get(name) || [];
                for (const dep of deps) {
                    visit(dep);
                }
                
                temp.delete(name);
                visited.add(name);
                order.push(name);
            }
        };

        for (const name of this.plugins.keys()) {
            if (!visited.has(name)) {
                visit(name);
            }
        }

        this.pluginLoadOrder = order;
    }

    // Hook system for plugins
    registerHooks(pluginName, hooks) {
        Object.entries(hooks).forEach(([hookName, hookFunction]) => {
            if (!this.hooks.has(hookName)) {
                this.hooks.set(hookName, []);
            }
            
            this.hooks.get(hookName).push({
                plugin: pluginName,
                function: hookFunction,
                priority: hookFunction.priority || 50
            });

            // Sort hooks by priority
            this.hooks.get(hookName).sort((a, b) => a.priority - b.priority);
        });
    }

    // Execute hooks with error handling
    async executeHook(hookName, ...args) {
        if (!this.hooks.has(hookName)) {
            return;
        }

        const hooks = this.hooks.get(hookName);
        const results = [];
        
        for (const hook of hooks) {
            if (!this.isPluginEnabled(hook.plugin)) {
                continue;
            }

            try {
                const result = await hook.function(...args, this.vani);
                results.push({
                    plugin: hook.plugin,
                    success: true,
                    result,
                    error: null
                });
            } catch (error) {
                console.error(`❌ Hook "${hookName}" from plugin "${hook.plugin}" failed:`, error);
                
                results.push({
                    plugin: hook.plugin,
                    success: false,
                    result: null,
                    error
                });

                this.executeHook('hook:error', {
                    hookName,
                    plugin: hook.plugin,
                    error
                });
            }
        }

        return results;
    }

    // Register CLI/console commands
    registerCommands(pluginName, commands) {
        if (!this.vani.commands) {
            this.vani.commands = {};
        }

        Object.entries(commands).forEach(([commandName, commandFunction]) => {
            const fullCommandName = `${pluginName}:${commandName}`;
            this.vani.commands[fullCommandName] = commandFunction;
            
            this.executeHook('command:registered', {
                plugin: pluginName,
                command: commandName,
                fullCommand: fullCommandName
            });
        });
    }

    // Get plugin instance
    get(name) {
        const pluginInfo = this.plugins.get(name);
        return pluginInfo ? pluginInfo.instance : null;
    }

    // Check if plugin exists and is enabled
    has(name) {
        const pluginInfo = this.plugins.get(name);
        return !!pluginInfo && pluginInfo.enabled;
    }

    // Check if plugin is enabled
    isPluginEnabled(name) {
        const pluginInfo = this.plugins.get(name);
        return !!pluginInfo && pluginInfo.enabled;
    }

    // Enable/disable plugin
    setPluginEnabled(name, enabled) {
        const pluginInfo = this.plugins.get(name);
        if (pluginInfo) {
            pluginInfo.enabled = enabled;
            
            this.executeHook('plugin:status-changed', {
                name,
                enabled,
                plugin: pluginInfo.instance
            });
            
            return true;
        }
        return false;
    }

    // Unregister plugin
    unregister(name) {
        const pluginInfo = this.plugins.get(name);
        if (pluginInfo) {
            // Cleanup if available
            if (pluginInfo.instance.cleanup && typeof pluginInfo.instance.cleanup === 'function') {
                try {
                    pluginInfo.instance.cleanup();
                } catch (error) {
                    console.error(`❌ Plugin "${name}" cleanup failed:`, error);
                }
            }

            // Remove hooks
            for (const [hookName, hooks] of this.hooks.entries()) {
                this.hooks.set(
                    hookName,
                    hooks.filter(hook => hook.plugin !== name)
                );
            }

            // Remove commands
            if (this.vani.commands) {
                Object.keys(this.vani.commands).forEach(commandName => {
                    if (commandName.startsWith(`${name}:`)) {
                        delete this.vani.commands[commandName];
                    }
                });
            }

            this.plugins.delete(name);
            this.pluginStates.delete(name);
            this.dependencies.delete(name);

            console.log(`✅ Plugin "${name}" unregistered`);
            this.executeHook('plugin:unregistered', { name });
            
            return true;
        }
        return false;
    }

    // Get all registered plugins
    getAll() {
        return Array.from(this.plugins.entries()).map(([name, info]) => ({
            name,
            enabled: info.enabled,
            version: info.version,
            status: this.pluginStates.get(name)?.status,
            options: info.options
        }));
    }

    // Get plugin status
    getStatus(name) {
        return this.pluginStates.get(name) || { status: 'not-registered' };
    }

    // Get all statuses
    getAllStatuses() {
        const statuses = {};
        for (const [name] of this.plugins) {
            statuses[name] = this.getStatus(name);
        }
        return statuses;
    }

    // Execute command
    async executeCommand(commandName, ...args) {
        if (!this.vani.commands || !this.vani.commands[commandName]) {
            throw new Error(`Command "${commandName}" not found`);
        }

        try {
            const result = await this.vani.commands[commandName](...args, this.vani);
            this.executeHook('command:executed', {
                command: commandName,
                args,
                result,
                success: true
            });
            return result;
        } catch (error) {
            this.executeHook('command:executed', {
                command: commandName,
                args,
                result: null,
                success: false,
                error
            });
            throw error;
        }
    }

    // Plugin configuration management
    getConfig(name, key, defaultValue = null) {
        const configKey = `plugin:${name}:${key}`;
        try {
            const item = localStorage.getItem(configKey);
            return item ? JSON.parse(item) : defaultValue;
        } catch {
            return defaultValue;
        }
    }

    setConfig(name, key, value) {
        const configKey = `plugin:${name}:${key}`;
        try {
            localStorage.setItem(configKey, JSON.stringify(value));
            return true;
        } catch {
            return false;
        }
    }

    // Destroy plugin system
    destroy() {
        // Cleanup all plugins
        for (const [name, pluginInfo] of this.plugins.entries()) {
            if (pluginInfo.instance.cleanup && typeof pluginInfo.instance.cleanup === 'function') {
                try {
                    pluginInfo.instance.cleanup();
                } catch (error) {
                    console.error(`❌ Plugin "${name}" cleanup during destroy failed:`, error);
                }
            }
        }

        this.plugins.clear();
        this.hooks.clear();
        this.pluginStates.clear();
        this.dependencies.clear();
        
        console.log('✅ Plugin system destroyed');
    }
}

// ==================== CORE PLUGINS ====================

// 1. State Persistence Plugin
const persistencePlugin = {
    init(vani, pluginSystem, options = {}) {
        this.vani = vani;
        this.pluginSystem = pluginSystem;
        this.options = {
            storageKey: 'vanijs_persisted_state',
            debounceDelay: 500,
            autoSave: true,
            ...options
        };
        
        this.debounceTimer = null;
        this.ignoredStateKeys = new Set(options.ignoreKeys || ['temp', 'ui']);
        
        // Load persisted state
        this.loadPersistedState();
        
        // Hook into state changes
        pluginSystem.registerHooks('persistence', {
            'state:create': (stateKey, initialState) => {
                if (this.shouldPersistState(stateKey)) {
                    this.saveStateDebounced();
                }
            },
            'state:update': (stateKey, oldState, newState) => {
                if (this.shouldPersistState(stateKey)) {
                    this.saveStateDebounced();
                }
            },
            'app:pause': () => this.savePersistedState(), // Save on app pause
            'app:resume': () => this.loadPersistedState() // Reload on app resume
        });

        // Auto-save before unload
        if (this.options.autoSave) {
            window.addEventListener('beforeunload', () => this.savePersistedState());
        }

        console.log('✅ State Persistence plugin initialized');
    },

    shouldPersistState(stateKey) {
        return stateKey.endsWith('_persist') && 
               !this.ignoredStateKeys.has(stateKey.replace('_persist', ''));
    },

    loadPersistedState() {
        try {
            const saved = localStorage.getItem(this.options.storageKey);
            if (saved) {
                const parsed = JSON.parse(saved);
                Object.assign(this.vani.state, parsed);
                
                this.pluginSystem.executeHook('persistence:state-loaded', {
                    state: parsed,
                    timestamp: Date.now()
                });
                
                console.log('✅ Persisted state loaded');
            }
        } catch (error) {
            console.error('❌ Failed to load persisted state:', error);
            this.pluginSystem.executeHook('persistence:load-error', { error });
        }
    },

    saveStateDebounced() {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        
        this.debounceTimer = setTimeout(() => {
            this.savePersistedState();
        }, this.options.debounceDelay);
    },

    savePersistedState() {
        try {
            const toPersist = Object.keys(this.vani.state)
                .filter(key => this.shouldPersistState(key))
                .reduce((acc, key) => {
                    acc[key] = this.vani.state[key];
                    return acc;
                }, {});

            localStorage.setItem(this.options.storageKey, JSON.stringify(toPersist));
            
            this.pluginSystem.executeHook('persistence:state-saved', {
                state: toPersist,
                timestamp: Date.now()
            });
            
            return true;
        } catch (error) {
            console.error('❌ Failed to persist state:', error);
            this.pluginSystem.executeHook('persistence:save-error', { error });
            return false;
        }
    },

    cleanup() {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        window.removeEventListener('beforeunload', this.savePersistedState);
        console.log('✅ State Persistence plugin cleaned up');
    }
};

// 2. DevTools Plugin
const devToolsPlugin = {
    init(vani, pluginSystem, options = {}) {
        this.vani = vani;
        this.pluginSystem = pluginSystem;
        this.options = {
            enabled: import.meta.env.MODE === 'development',
            exposeGlobal: true,
            ...options
        };

        if (!this.options.enabled) {
            return;
        }

        this.setupDevTools();
        this.setupConsoleCommands();
        
        console.log('✅ DevTools plugin initialized');
    },

    setupDevTools() {
        const devTools = {
            // Framework state inspection
            getState: () => ({ ...this.vani.state }),
            getRoutes: () => ({ ...this.vani.router?.routes }),
            getTranslations: () => ({ ...this.vani.i18n }),
            getComponents: () => Object.keys(this.vani.components),
            getPlugins: () => this.pluginSystem.getAll(),
            
            // Navigation control
            navigate: (path) => this.vani.navigate(path),
            getHistory: () => this.vani.router?.getHistory() || [],
            
            // Plugin control
            getPlugin: (name) => this.pluginSystem.get(name),
            enablePlugin: (name) => this.pluginSystem.setPluginEnabled(name, true),
            disablePlugin: (name) => this.pluginSystem.setPluginEnabled(name, false),
            
            // Internationalization
            setLanguage: (lang) => this.vani.setLanguage(lang),

            // Performance
            getMetrics: () => this.vani.getMetrics?.(),
            clearMetrics: () => this.vani.clearMetrics?.(),
            
            // Utilities
            reload: () => window.location.reload(),
            version: '1.0.0'
        };

        if (this.options.exposeGlobal) {
            window.__VANIJS_DEVTOOLS__ = devTools;
        }

        this.vani.devtools = devTools;
        this.pluginSystem.executeHook('devtools:ready', { devTools });
    },

    setupConsoleCommands() {
        this.pluginSystem.registerCommands('devtools', {
            'inspect-state': () => console.log('State:', this.vani.devtools.getState()),
            'list-routes': () => console.log('Routes:', this.vani.devtools.getRoutes()),
            'list-plugins': () => console.log('Plugins:', this.vani.devtools.getPlugins()),
            'performance-metrics': () => console.log('Metrics:', this.vani.devtools.getMetrics()),
            'reload': () => this.vani.devtools.reload()
        });
    },

    cleanup() {
        delete window.__VANIJS_DEVTOOLS__;
        delete this.vani.devtools;
        console.log('✅ DevTools plugin cleaned up');
    }
};

// 3. Error Tracking Plugin
const errorTrackingPlugin = {
    init(vani, pluginSystem, options = {}) {
        this.vani = vani;
        this.pluginSystem = pluginSystem;
        this.options = {
            maxStoredErrors: 50,
            autoReport: true,
            captureWindowErrors: true,
            capturePromiseRejections: true,
            ...options
        };

        this.setupErrorHandling();
        this.setupErrorReporting();
        
        console.log('✅ Error Tracking plugin initialized');
    },

    setupErrorHandling() {
        // Window error handler
        if (this.options.captureWindowErrors) {
            window.addEventListener('error', (event) => {
                this.trackError('window_error', event.error, {
                    filename: event.filename,
                    lineno: event.lineno,
                    colno: event.colno
                });
            });
        }

        // Unhandled rejection handler
        if (this.options.capturePromiseRejections) {
            window.addEventListener('unhandledrejection', (event) => {
                this.trackError('unhandled_rejection', event.reason);
            });
        }

        // Component error boundary
        const originalRenderComponent = this.vani.renderComponent.bind(this.vani);
        this.vani.renderComponent = async (...args) => {
            try {
                return await originalRenderComponent(...args);
            } catch (error) {
                this.trackError('component_error', error, { component: args[0] });
                throw error;
            }
        };

        // Router error handling
        this.pluginSystem.registerHooks('error-tracking', {
            'router:error': (context) => this.trackError('router_error', context.error, {
                path: context.path
            }),
            'middleware:error': (context) => this.trackError('middleware_error', context.error, {
                middleware: context.middleware
            })
        });
    },

    setupErrorReporting() {
        // Periodic error report flushing
        setInterval(() => {
            this.flushErrorReports();
        }, 30000); // Every 30 seconds
    },

    trackError(type, error, metadata = {}) {
        const errorData = {
            type,
            message: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString(),
            url: window.location.href,
            user: this.vani.auth.user?.id || 'anonymous',
            ...metadata
        };

        console.error('🔴 VaniJS Error:', errorData);
        
        // Store error locally
        const errors = JSON.parse(localStorage.getItem('vanijs_errors') || '[]');
        errors.unshift(errorData);
        localStorage.setItem('vanijs_errors', JSON.stringify(errors.slice(0, this.options.maxStoredErrors)));

        // Auto-report to external service
        if (this.options.autoReport) {
            this.reportError(errorData);
        }

        this.pluginSystem.executeHook('error:tracked', errorData);
    },

    reportError(errorData) {
        // Send to error tracking service
        if (typeof navigator.sendBeacon === 'function') {
            navigator.sendBeacon('/api/errors', JSON.stringify(errorData));
        }

        // Or use fetch with low priority
        fetch('/api/errors', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(errorData),
            keepalive: true // Important for page unload scenarios
        }).catch(() => { /* Silent fail */ });
    },

    flushErrorReports() {
        const errors = JSON.parse(localStorage.getItem('vanijs_errors') || '[]');
        if (errors.length > 0) {
            // Batch send errors
            fetch('/api/errors/batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ errors })
            }).then(() => {
                // Clear sent errors
                localStorage.removeItem('vanijs_errors');
            }).catch(() => { /* Retry later */ });
        }
    },

    getStoredErrors() {
        return JSON.parse(localStorage.getItem('vanijs_errors') || '[]');
    },

    clearStoredErrors() {
        localStorage.removeItem('vanijs_errors');
    },

    cleanup() {
        window.removeEventListener('error', this.trackError);
        window.removeEventListener('unhandledrejection', this.trackError);
        console.log('✅ Error Tracking plugin cleaned up');
    }
};

// 4. Performance Monitoring Plugin
const performancePlugin = {
    init(vani, pluginSystem, options = {}) {
        this.vani = vani;
        this.pluginSystem = pluginSystem;
        this.options = {
            samplingRate: 1.0, // 100% sampling
            maxMetrics: 1000,
            autoExport: false,
            ...options
        };

        this.metrics = [];
        this.setupPerformanceMonitoring();
        
        console.log('✅ Performance Monitoring plugin initialized');
    },

    setupPerformanceMonitoring() {
        // Route change timing
        this.pluginSystem.registerHooks('performance', {
            'router:complete': (context) => {
                this.recordMetric('route_change', context.duration, {
                    path: context.context.path,
                    from: context.context.from
                });
            },
            'component:render': (context) => {
                this.recordMetric('component_render', context.renderTime, {
                    component: context.name,
                    nodes: this.countNodes(context.result)
                });
            },
            'render:complete': (context) => {
                this.recordMetric('dom_render', context.renderTime, {
                    nodes: this.countNodes(context.vnode)
                });
            }
        });

        // Core Web Vitals
        if ('PerformanceObserver' in window) {
            this.setupCoreWebVitals();
        }

        // Memory monitoring
        if ('memory' in performance) {
            setInterval(() => this.recordMemoryUsage(), 30000);
        }
    },

    setupCoreWebVitals() {
        // LCP (Largest Contentful Paint)
        new PerformanceObserver((entryList) => {
            const entries = entryList.getEntries();
            const lastEntry = entries[entries.length - 1];
            this.recordMetric('lcp', lastEntry.startTime, { element: lastEntry.element });
        }).observe({ type: 'largest-contentful-paint', buffered: true });

        // FID (First Input Delay)
        new PerformanceObserver((entryList) => {
            const entries = entryList.getEntries();
            entries.forEach(entry => {
                this.recordMetric('fid', entry.processingStart - entry.startTime, {
                    event: entry.name,
                    target: entry.target?.nodeName
                });
            });
        }).observe({ type: 'first-input', buffered: true });

        // CLS (Cumulative Layout Shift)
        new PerformanceObserver((entryList) => {
            let cls = 0;
            entryList.getEntries().forEach(entry => {
                if (!entry.hadRecentInput) {
                    cls += entry.value;
                }
            });
            this.recordMetric('cls', cls);
        }).observe({ type: 'layout-shift', buffered: true });
    },

    recordMetric(name, value, metadata = {}) {
        if (Math.random() > this.options.samplingRate) {
            return;
        }

        const metric = {
            name,
            value,
            timestamp: Date.now(),
            ...metadata
        };

        this.metrics.push(metric);
        
        // Trim metrics array
        if (this.metrics.length > this.options.maxMetrics) {
            this.metrics = this.metrics.slice(-this.options.maxMetrics);
        }

        this.pluginSystem.executeHook('performance:metric', metric);
        
        if (this.options.autoExport) {
            this.exportMetrics();
        }
    },

    recordMemoryUsage() {
        if (performance.memory) {
            this.recordMetric('memory_usage', performance.memory.usedJSHeapSize, {
                total: performance.memory.totalJSHeapSize,
                limit: performance.memory.jsHeapSizeLimit
            });
        }
    },

    countNodes(vnode) {
        if (typeof vnode === 'string' || typeof vnode === 'number') return 1;
        if (!vnode || !vnode.children) return 0;
        
        return 1 + vnode.children.reduce((sum, child) => 
            sum + this.countNodes(child), 0
        );
    },

    exportMetrics() {
        if (this.metrics.length > 0) {
            navigator.sendBeacon('/api/performance', JSON.stringify(this.metrics));
        }
    },

    getMetrics() {
        return [...this.metrics];
    },

    clearMetrics() {
        this.metrics = [];
    },

    cleanup() {
        this.clearMetrics();
        console.log('✅ Performance Monitoring plugin cleaned up');
    }
};

// 5. Analytics Plugin
const analyticsPlugin = {
    init(vani, pluginSystem, options = {}) {
        this.vani = vani;
        this.pluginSystem = pluginSystem;
        const cfg = (window.vaniApp && window.vaniApp.config) || {};
        this.gaId = options.gaId ?? cfg.integrations?.gaId ?? import.meta.env.VITE_GA_ID;
        this.fbPixelId = options.fbPixelId ?? cfg.integrations?.fbPixelId ?? import.meta.env.VITE_FB_PIXEL_ID;
        const baseURL = options.baseURL ?? cfg.api?.baseURL ?? import.meta.env.VITE_API_URL;
        const defaultEndpoint = (this.gaId || this.fbPixelId) && baseURL
            ? (String(baseURL).replace(/\/$/, '') + '/analytics')
            : undefined;
        this.endpoint = options.endpoint ?? defaultEndpoint;

        // Disable analytics entirely if no tracking configuration is provided
        if (!this.gaId && !this.fbPixelId && !this.endpoint) {
            console.warn('⚠️ Analytics plugin disabled: no tracking IDs configured');
            this.options = {
                trackPageViews: false,
                trackEvents: false,
                trackErrors: false,
                trackPerformance: false,
                ...options
            };
            return;
        }

        this.options = {
            trackPageViews: true,
            trackEvents: true,
            trackErrors: true,
            trackPerformance: false,
            ...options
        };

        this.setupAnalytics();
        this.setupAutoTracking();
        this.loadAnalyticsLibraries();

        console.log('✅ Analytics plugin initialized');
    },

    setupAnalytics() {
        // Make analytics available globally
        this.vani.trackEvent = (name, data) => this.trackEvent(name, data);
        this.vani.trackPageView = (path, data) => this.trackPageView(path, data);
    },

    setupAutoTracking() {
        if (this.options.trackPageViews) {
            this.pluginSystem.registerHooks('analytics', {
                'route:change': (context) => {
                    this.trackPageView(context.to, {
                        from: context.from,
                        params: context.params,
                        duration: context.duration
                    });
                }
            });
        }

        // Bridge performance metrics -> analytics
        this.pluginSystem.registerHooks('analytics', {
            'performance:metric': (metric) => {
                this.trackEvent('performance_metric', metric);
            }
        });

        if (this.options.trackErrors) {
            this.pluginSystem.registerHooks('analytics', {
                'error:tracked': (errorData) => {
                    this.trackEvent('error_occurred', {
                        error_type: errorData.type,
                        error_message: errorData.message,
                        component: errorData.component
                    });
                }
            });
        }
    },

    loadAnalyticsLibraries() {
        // GA gtag bootstrap (queue until script loads)
        if (this.gaId && !window.dataLayer) {
            window.dataLayer = window.dataLayer || [];
            window.gtag = function(){ window.dataLayer.push(arguments); };
            window.gtag('js', new Date());
            window.gtag('config', this.gaId);
            const s = document.createElement('script');
            s.async = true;
            s.src = `https://www.googletagmanager.com/gtag/js?id=${this.gaId}`;
            document.head.appendChild(s);
        }

        // Facebook Pixel bootstrap
        if (this.fbPixelId && !window.fbq) {
            !function(f,b,e,v,n,t,s){
                if(f.fbq)return;n=f.fbq=function(){n.callMethod?
                n.callMethod.apply(n,arguments):n.queue.push(arguments)};
                if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
                n.queue=[];t=b.createElement(e);t.async=!0;
                t.src=v;s=b.getElementsByTagName(e)[0];
                s.parentNode.insertBefore(t,s)
            }(window, document,'script','https://connect.facebook.net/en_US/fbevents.js');
            fbq('init', this.fbPixelId);
            fbq('track', 'PageView');
        }
    },

    trackEvent(name, data = {}) {
        const eventData = {
            name,
            timestamp: new Date().toISOString(),
            url: window.location.href,
            user: this.vani.auth.user?.id || 'anonymous',
            session: this.getSessionId(),
            ...data
        };

        // Console logging in development
        if (import.meta.env.MODE === 'development') {
            console.log('📊 Analytics Event:', eventData);
        }

        // Send to analytics services
        this.sendToAnalyticsServices(eventData);

        this.pluginSystem.executeHook('analytics:event', eventData);
    },

    trackPageView(path, data = {}) {
        this.trackEvent('page_view', {
            path,
            ...data
        });
    },

    sendToAnalyticsServices(eventData) {
        // Google Analytics
        if (this.gaId && typeof gtag === 'function') {
            gtag('event', eventData.name, eventData);
        }

        // Facebook Pixel
        if (this.fbPixelId && typeof fbq === 'function') {
            // Use trackCustom to avoid GA/Facebook name collisions
            fbq('trackCustom', eventData.name, eventData);
        }

        // Custom endpoint with beacon API
        if (this.endpoint && typeof navigator.sendBeacon === 'function') {
            navigator.sendBeacon(this.endpoint, JSON.stringify(eventData));
        }
    },

    getSessionId() {
        let sessionId = sessionStorage.getItem('analytics_session_id');
        if (!sessionId) {
            sessionId = Math.random().toString(36).substring(2) + Date.now().toString(36);
            sessionStorage.setItem('analytics_session_id', sessionId);
        }
        return sessionId;
    },

    cleanup() {
        delete this.vani.trackEvent;
        delete this.vani.trackPageView;
        console.log('✅ Analytics plugin cleaned up');
    }
};

// ==================== PLUGIN REGISTRATION ====================

// Initialize plugin system
const vaniPluginSystem = new VaniPluginSystem(vani);
vani.pluginSystem = vaniPluginSystem;

// Register core plugins with dependencies
vaniPluginSystem.register('persistence', persistencePlugin, {
    version: '1.0.0',
    autoInit: true
});

vaniPluginSystem.register('error-tracking', errorTrackingPlugin, {
    version: '1.0.0',
    autoInit: true
});

vaniPluginSystem.register('performance', performancePlugin, {
    version: '1.0.0',
    dependencies: ['error-tracking'],
    autoInit: true
});

vaniPluginSystem.register('analytics', analyticsPlugin, {
    version: '1.0.0',
    dependencies: ['performance'],
    autoInit: true
});

vaniPluginSystem.register('devtools', devToolsPlugin, {
    version: '1.0.0',
    dependencies: ['persistence', 'error-tracking'],
    autoInit: import.meta.env.MODE === 'development'
});

// Initialize all plugins when framework is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        vaniPluginSystem.initializeAll();
    });
} else {
    vaniPluginSystem.initializeAll();
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        vaniPluginSystem,
        VaniPluginSystem,
        persistencePlugin,
        devToolsPlugin,
        errorTrackingPlugin,
        performancePlugin,
        analyticsPlugin
    };
}

// Global access for debugging
if (typeof window !== 'undefined') {
    window.vaniPlugins = {
        system: vaniPluginSystem,
        core: {
            persistence: persistencePlugin,
            devtools: devToolsPlugin,
            errorTracking: errorTrackingPlugin,
            performance: performancePlugin,
            analytics: analyticsPlugin
        }
    };
}

export {
    vaniPluginSystem,
    VaniPluginSystem,
    persistencePlugin,
    devToolsPlugin,
    errorTrackingPlugin,
    performancePlugin,
    analyticsPlugin
};
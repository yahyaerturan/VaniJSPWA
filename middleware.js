// middleware.js - Production Ready Middleware System for VaniJS

// ==================== CORE MIDDLEWARE UTILITIES ====================
const MiddlewareUtils = {
    // Debounce function for rate limiting
    debounce: (func, wait) => {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },

    // Throttle function for rate limiting
    throttle: (func, limit) => {
        let inThrottle;
        return function(...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    },

    // Safe local storage access
    safeStorage: {
        get: (key, defaultValue = null) => {
            try {
                const item = localStorage.getItem(key);
                return item ? JSON.parse(item) : defaultValue;
            } catch (error) {
                console.warn('Failed to read from localStorage:', error);
                return defaultValue;
            }
        },
        set: (key, value) => {
            try {
                localStorage.setItem(key, JSON.stringify(value));
                return true;
            } catch (error) {
                console.warn('Failed to write to localStorage:', error);
                return false;
            }
        },
        remove: (key) => {
            try {
                localStorage.removeItem(key);
                return true;
            } catch (error) {
                console.warn('Failed to remove from localStorage:', error);
                return false;
            }
        }
    },

    // Error factory for consistent error messages
    createError: (type, message, metadata = {}) => {
        const error = new Error(message);
        error.type = type;
        error.metadata = metadata;
        error.timestamp = new Date().toISOString();
        return error;
    },

    // Parameter validation
    validateParams: (params, rules) => {
        const errors = [];
        
        Object.keys(rules).forEach(param => {
            const value = params[param];
            const rule = rules[param];
            
            if (rule.required && (value === undefined || value === null || value === '')) {
                errors.push(`${param} is required`);
                return;
            }
            
            if (value !== undefined && value !== null) {
                if (rule.minLength && value.length < rule.minLength) {
                    errors.push(`${param} must be at least ${rule.minLength} characters`);
                }
                
                if (rule.maxLength && value.length > rule.maxLength) {
                    errors.push(`${param} must be at most ${rule.maxLength} characters`);
                }
                
                if (rule.pattern && !rule.pattern.test(String(value))) {
                    errors.push(`${param} format is invalid`);
                }
                
                if (rule.enum && !rule.enum.includes(value)) {
                    errors.push(`${param} must be one of: ${rule.enum.join(', ')}`);
                }
                
                if (rule.type && typeof value !== rule.type) {
                    errors.push(`${param} must be of type ${rule.type}`);
                }
                
                if (rule.min !== undefined && value < rule.min) {
                    errors.push(`${param} must be at least ${rule.min}`);
                }
                
                if (rule.max !== undefined && value > rule.max) {
                    errors.push(`${param} must be at most ${rule.max}`);
                }
            }
        });
        
        return errors;
    }
};

// ==================== AUTHENTICATION MIDDLEWARES ====================
const authMiddlewares = {
    // Require authentication
    requireAuth: (context, next) => {
        if (!context.vani.isAuthenticated()) {
            context.redirect('/login?return=' + encodeURIComponent(context.path));
            throw new Error('Navigation cancelled');
        }
        return next();
    },

    // Require guest (non-authenticated)
    requireGuest: (context, next) => {
        if (context.vani.isAuthenticated()) {
            context.redirect('/');
            throw new Error('Navigation cancelled');
        }
        return next();
    },

    // Require specific role
    requireRole: (role) => (context, next) => {
        if (!context.vani.isAuthenticated() || context.vani.auth.user.role !== role) {
            const error = MiddlewareUtils.createError(
                'ROLE_REQUIRED',
                `Role ${role} required`,
                { 
                    requiredRole: role, 
                    currentRole: context.vani.auth.user?.role 
                }
            );
            
            if (context.vani.pluginSystem) {
                context.vani.pluginSystem.executeHook('middleware:auth:role-violation', error);
            }
            
            context.redirect('/unauthorized');
            throw error;
        }
        return next();
    },

    // Require any of multiple roles
    requireAnyRole: (...roles) => (context, next) => {
        if (!context.vani.isAuthenticated() || !roles.includes(context.vani.auth.user.role)) {
            const error = MiddlewareUtils.createError(
                'ANY_ROLE_REQUIRED',
                `Any of these roles required: ${roles.join(', ')}`,
                { 
                    requiredRoles: roles, 
                    currentRole: context.vani.auth.user?.role 
                }
            );
            
            context.redirect('/unauthorized');
            throw error;
        }
        return next();
    },

    // Auto-redirect after login
    redirectIfAuthenticated: (defaultPath = '/') => (context, next) => {
        if (context.vani.isAuthenticated()) {
            const returnUrl = context.params.return || context.query.return || defaultPath;
            context.redirect(returnUrl);
            throw MiddlewareUtils.createError('REDIRECT_AUTHENTICATED', 'Already authenticated');
        }
        return next();
    },

    // Validate authentication tokens
    validateAuth: (context, next) => {
        if (context.vani.isAuthenticated()) {
            const tokens = context.vani.auth.tokens;
            if (tokens && tokens.expires_at < Date.now()) {
                // Token expired
                context.vani.auth.logout();
                context.redirect('/login?expired=true');
                throw MiddlewareUtils.createError('TOKEN_EXPIRED', 'Authentication token expired');
            }
        }
        return next();
    }
};

// ==================== PERMISSION MIDDLEWARES ====================
const permissionMiddlewares = {
    // Require specific permission
    requirePermission: (permission) => (context, next) => {
        if (!context.vani.checkPermission(permission)) {
            const error = MiddlewareUtils.createError(
                'PERMISSION_REQUIRED',
                `Permission ${permission} required`,
                { permission }
            );
            
            if (context.vani.pluginSystem) {
                context.vani.pluginSystem.executeHook('middleware:permission:denied', error);
            }
            
            context.redirect('/unauthorized');
            throw error;
        }
        return next();
    },

    // Require any of the given permissions
    requireAnyPermission: (...permissions) => (context, next) => {
        const hasAny = permissions.some(perm => context.vani.checkPermission(perm));
        if (!hasAny) {
            const error = MiddlewareUtils.createError(
                'ANY_PERMISSION_REQUIRED',
                `Any of these permissions required: ${permissions.join(', ')}`,
                { permissions }
            );
            
            context.redirect('/unauthorized');
            throw error;
        }
        return next();
    },

    // Require all of the given permissions
    requireAllPermissions: (...permissions) => (context, next) => {
        const hasAll = permissions.every(perm => context.vani.checkPermission(perm));
        if (!hasAll) {
            const error = MiddlewareUtils.createError(
                'ALL_PERMISSIONS_REQUIRED',
                `All these permissions required: ${permissions.join(', ')}`,
                { permissions }
            );
            
            context.redirect('/unauthorized');
            throw error;
        }
        return next();
    },

    // Check feature flags
    requireFeature: (featureName) => (context, next) => {
        const features = MiddlewareUtils.safeStorage.get('feature_flags', {});
        if (!features[featureName]) {
            const error = MiddlewareUtils.createError(
                'FEATURE_DISABLED',
                `Feature ${featureName} is not enabled`,
                { featureName }
            );
            
            context.redirect('/feature-unavailable');
            throw error;
        }
        return next();
    }
};

// ==================== ROUTER & NAVIGATION MIDDLEWARES ====================
const routerMiddlewares = {
    // Log navigation with performance metrics
    navigationLogger: (context, next) => {
        const startTime = performance.now();
        const navigationId = Math.random().toString(36).substring(7);
        
        if (context.vani.pluginSystem) {
            context.vani.pluginSystem.executeHook('middleware:navigation:start', {
                id: navigationId,
                context,
                startTime
            });
        }

        return next().then(() => {
            const duration = performance.now() - startTime;
            
            if (context.vani.pluginSystem) {
                context.vani.pluginSystem.executeHook('middleware:navigation:complete', {
                    id: navigationId,
                    context,
                    duration
                });
            }

            console.log(`🛣️  Navigation: ${context.from || 'none'} → ${context.to} (${duration.toFixed(2)}ms)`, {
                params: context.params,
                navigationId,
                duration
            });
        }).catch(error => {
            const duration = performance.now() - startTime;
            
            if (context.vani.pluginSystem) {
                context.vani.pluginSystem.executeHook('middleware:navigation:error', {
                    id: navigationId,
                    context,
                    error,
                    duration
                });
            }

            console.error(`🛣️  Navigation failed: ${context.from || 'none'} → ${context.to}`, {
                error: error.message,
                navigationId,
                duration
            });
            
            throw error;
        });
    },

    // Analytics tracking
    analyticsTracker: (context, next) => {
        const trackEvent = (eventName, eventData = {}) => {
            const event = {
                name: eventName,
                timestamp: new Date().toISOString(),
                url: window.location.href,
                ...eventData
            };

            // Google Analytics
            if (typeof gtag === 'function') {
                gtag('event', eventName, event);
            }

            // Facebook Pixel
            if (typeof fbq === 'function') {
                fbq('track', eventName, event);
            }

            // Custom analytics endpoint
            if (typeof navigator.sendBeacon === 'function') {
                navigator.sendBeacon('/api/analytics', JSON.stringify(event));
            }

            if (context.vani.pluginSystem) {
                context.vani.pluginSystem.executeHook('analytics:event', event);
            }
        };

        trackEvent('page_view', {
            path: context.to,
            referrer: context.from,
            params: context.params
        });

        return next();
    },

    // Scroll to top on navigation
    scrollToTop: (context, next) => {
        const scrollBehavior = context.params.noScroll ? 'auto' : 'smooth';
        
        window.scrollTo({
            top: 0,
            behavior: scrollBehavior
        });

        return next();
    },

    // Route parameter validation
    validateParams: (validationRules) => (context, next) => {
        const errors = MiddlewareUtils.validateParams(context.params, validationRules);
        
        if (errors.length > 0) {
            const error = MiddlewareUtils.createError(
                'PARAM_VALIDATION_FAILED',
                'Route parameter validation failed',
                { errors, params: context.params, rules: validationRules }
            );
            
            if (context.vani.pluginSystem) {
                context.vani.pluginSystem.executeHook('middleware:validation:failed', error);
            }
            
            context.redirect('/invalid-parameters');
            throw error;
        }
        
        return next();
    },

    // Query parameter parsing
    parseQueryParams: (context, next) => {
        const url = new URL(window.location.href);
        context.query = Object.fromEntries(url.searchParams.entries());
        return next();
    },

    // Navigation history tracking
    trackHistory: (context, next) => {
        if (context.vani.router) {
            const history = context.vani.router.getHistory();
            if (context.vani.pluginSystem) {
                context.vani.pluginSystem.executeHook('navigation:history', {
                    history,
                    current: context.to,
                    previous: context.from
                });
            }
        }
        return next();
    }
};

// ==================== DATA & API MIDDLEWARES ====================
const dataMiddlewares = {
    // Fetch data before rendering
    withData: (fetcher, options = {}) => async (context, next) => {
        const { cacheKey, ttl = 300000, forceRefresh = false } = options;
        
        try {
            let data;
            
            // Check cache first
            if (cacheKey && !forceRefresh) {
                const cached = MiddlewareUtils.safeStorage.get(cacheKey);
                if (cached && Date.now() - cached.timestamp < ttl) {
                    data = cached.data;
                    context.cachedData = data;
                    
                    if (context.vani.pluginSystem) {
                        context.vani.pluginSystem.executeHook('middleware:data:cache-hit', {
                            cacheKey,
                            data
                        });
                    }
                }
            }

            // Fetch fresh data if not cached
            if (!data) {
                data = await fetcher(context);
                
                // Cache the data
                if (cacheKey) {
                    MiddlewareUtils.safeStorage.set(cacheKey, {
                        data,
                        timestamp: Date.now()
                    });
                    
                    if (context.vani.pluginSystem) {
                        context.vani.pluginSystem.executeHook('middleware:data:cache-miss', {
                            cacheKey,
                            data
                        });
                    }
                }
            }

            context.data = data;
            
            if (context.vani.pluginSystem) {
                context.vani.pluginSystem.executeHook('middleware:data:success', {
                    data,
                    context
                });
            }
            
            return next();
        } catch (error) {
            console.error('Data fetching failed:', error);
            
            if (context.vani.pluginSystem) {
                context.vani.pluginSystem.executeHook('middleware:data:error', {
                    error,
                    context
                });
            }
            
            context.redirect('/error?type=data-fetch');
            throw MiddlewareUtils.createError('DATA_FETCH_FAILED', 'Data fetching failed', { error });
        }
    },

    // Pagination middleware
    withPagination: (defaultPage = 1, defaultLimit = 10, options = {}) => (context, next) => {
        const { pageParam = 'page', limitParam = 'limit' } = options;
        
        const page = Math.max(1, parseInt(context.params[pageParam]) || defaultPage);
        const limit = Math.max(1, Math.min(100, parseInt(context.params[limitParam]) || defaultLimit));
        const offset = (page - 1) * limit;
        
        context.pagination = {
            page,
            limit,
            offset,
            hasNext: false, // Will be set after data fetch
            hasPrev: page > 1,
            total: 0,
            totalPages: 0
        };
        
        return next();
    },

    // API response normalization
    normalizeResponse: (normalizer) => async (context, next) => {
        await next();
        
        if (context.data) {
            try {
                context.data = normalizer(context.data);
                
                if (context.vani.pluginSystem) {
                    context.vani.pluginSystem.executeHook('middleware:data:normalized', {
                        original: context.data,
                        normalized: context.data
                    });
                }
            } catch (error) {
                console.error('Response normalization failed:', error);
                
                if (context.vani.pluginSystem) {
                    context.vani.pluginSystem.executeHook('middleware:data:normalization-error', {
                        error,
                        data: context.data
                    });
                }
            }
        }
    }
};

// ==================== SECURITY MIDDLEWARES ====================
const securityMiddlewares = {
    // CSRF protection
    csrfProtection: (context, next) => {
        const token = MiddlewareUtils.safeStorage.get('csrf_token');
        if (!token) {
            const error = MiddlewareUtils.createError('CSRF_TOKEN_MISSING', 'CSRF token required');
            
            if (context.vani.pluginSystem) {
                context.vani.pluginSystem.executeHook('middleware:security:csrf-missing', error);
            }
            
            context.redirect('/error?type=csrf');
            throw error;
        }

        // Add CSRF token to all fetch requests
        const originalFetch = window.fetch;
        window.fetch = function(...args) {
            const [url, options = {}] = args;
            options.headers = {
                ...options.headers,
                'X-CSRF-Token': token,
                'X-Requested-With': 'XMLHttpRequest'
            };
            return originalFetch.call(this, url, options);
        };

        // Restore original fetch after navigation
        const cleanup = () => {
            window.fetch = originalFetch;
            window.removeEventListener('hashchange', cleanup);
        };

        window.addEventListener('hashchange', cleanup);

        return next();
    },

    // Rate limiting
    rateLimit: (maxRequests = 100, timeWindow = 60000, identifier = 'global') => (context, next) => {
        const key = `rate_limit_${identifier}_${context.to}`;
        const now = Date.now();
        const requests = MiddlewareUtils.safeStorage.get(key, [])
            .filter(timestamp => now - timestamp < timeWindow);

        if (requests.length >= maxRequests) {
            const error = MiddlewareUtils.createError(
                'RATE_LIMIT_EXCEEDED',
                'Rate limit exceeded',
                { maxRequests, timeWindow, identifier }
            );
            
            if (context.vani.pluginSystem) {
                context.vani.pluginSystem.executeHook('middleware:security:rate-limit', error);
            }
            
            context.redirect('/rate-limited');
            throw error;
        }

        requests.push(now);
        MiddlewareUtils.safeStorage.set(key, requests);

        return next();
    },

    // XSS protection
    xssProtection: (context, next) => {
        const sanitize = (value) => {
            if (typeof value === 'string') {
                return value
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/'/g, '&#x27;')
                    .replace(/"/g, '&quot;')
                    .replace(/\//g, '&#x2F;');
            }
            return value;
        };

        // Sanitize route parameters
        Object.keys(context.params).forEach(key => {
            context.params[key] = sanitize(context.params[key]);
        });

        // Sanitize query parameters
        if (context.query) {
            Object.keys(context.query).forEach(key => {
                context.query[key] = sanitize(context.query[key]);
            });
        }

        return next();
    },

    // Content Security Policy helper
    cspHeaders: (context, next) => {
        // This would typically be set server-side, but we can add meta tags
        if (!document.querySelector('meta[http-equiv="Content-Security-Policy"]')) {
            const meta = document.createElement('meta');
            meta.httpEquiv = "Content-Security-Policy";
            meta.content = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'";
            document.head.appendChild(meta);
        }
        
        return next();
    }
};

// ==================== PERFORMANCE & OPTIMIZATION MIDDLEWARES ====================
const performanceMiddlewares = {
    // Resource preloading
    preloadResources: (resources = []) => (context, next) => {
        resources.forEach(resource => {
            const link = document.createElement('link');
            link.rel = 'preload';
            link.href = resource.url;
            link.as = resource.as || 'fetch';
            if (resource.crossOrigin) link.crossOrigin = resource.crossOrigin;
            document.head.appendChild(link);
        });

        return next();
    },

    // Lazy loading helper
    lazyLoad: (threshold = 0.1) => (context, next) => {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    img.src = img.dataset.src;
                    if (img.dataset.srcset) img.srcset = img.dataset.srcset;
                    observer.unobserve(img);
                }
            });
        }, { threshold });

        // Observe images with data-src
        document.querySelectorAll('img[data-src]').forEach(img => {
            observer.observe(img);
        });

        return next();
    },

    // Memory management
    memoryManagement: (context, next) => {
        // Clean up large data structures after navigation
        const cleanup = () => {
            if (context.vani.vdom && context.vani.vdom.currentTree) {
                // Keep only the current tree to save memory
                context.vani.vdom.currentTree = null;
            }
        };

        window.addEventListener('hashchange', cleanup, { once: true });

        return next();
    }
};

// ==================== ERROR HANDLING & RESILIENCE MIDDLEWARES ====================
const errorMiddlewares = {
    // Global error handler
    errorHandler: (context, next) => {
        return next().catch(error => {
            console.error('Middleware error:', error);
            
            if (context.vani.pluginSystem) {
                context.vani.pluginSystem.executeHook('middleware:error:global', {
                    error,
                    context
                });
            }

            if (error.type === 'AUTH_REQUIRED' || error.message.includes('Authentication')) {
                context.redirect('/login');
            } else if (error.type === 'PERMISSION_REQUIRED' || error.message.includes('Permission')) {
                context.redirect('/unauthorized');
            } else if (error.type === 'RATE_LIMIT_EXCEEDED') {
                context.redirect('/rate-limited');
            } else {
                context.redirect('/error');
            }
            
            throw error;
        });
    },

    // Retry middleware with exponential backoff
    withRetry: (maxAttempts = 3, baseDelay = 1000) => async (context, next) => {
        let lastError;
        
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await next();
            } catch (error) {
                lastError = error;
                
                if (context.vani.pluginSystem) {
                    context.vani.pluginSystem.executeHook('middleware:retry:attempt', {
                        attempt,
                        maxAttempts,
                        error,
                        context
                    });
                }

                if (attempt < maxAttempts) {
                    const delay = baseDelay * Math.pow(2, attempt - 1);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        
        throw lastError;
    },

    // Circuit breaker pattern
    circuitBreaker: (options = {}) => {
        const {
            failureThreshold = 5,
            resetTimeout = 30000,
            name = 'default'
        } = options;
        
        let state = 'CLOSED';
        let failureCount = 0;
        let nextAttempt = Date.now();

        return async (context, next) => {
            if (state === 'OPEN') {
                if (Date.now() > nextAttempt) {
                    state = 'HALF_OPEN';
                } else {
                    throw MiddlewareUtils.createError(
                        'CIRCUIT_OPEN',
                        `Circuit breaker open for ${name}`,
                        { name, nextAttempt }
                    );
                }
            }

            try {
                const result = await next();
                
                if (state === 'HALF_OPEN') {
                    state = 'CLOSED';
                    failureCount = 0;
                }
                
                return result;
            } catch (error) {
                failureCount++;
                
                if (failureCount >= failureThreshold) {
                    state = 'OPEN';
                    nextAttempt = Date.now() + resetTimeout;
                    
                    if (context.vani.pluginSystem) {
                        context.vani.pluginSystem.executeHook('middleware:circuit:opened', {
                            name,
                            failureCount,
                            nextAttempt,
                            error
                        });
                    }
                }
                
                throw error;
            }
        };
    }
};

// ==================== EXPORT ALL MIDDLEWARES ====================
export const vaniMiddlewares = {
    // Utility functions
    utils: MiddlewareUtils,
    
    // Middleware categories
    auth: authMiddlewares,
    permission: permissionMiddlewares,
    router: routerMiddlewares,
    data: dataMiddlewares,
    security: securityMiddlewares,
    performance: performanceMiddlewares,
    error: errorMiddlewares,
    
    // Individual middlewares for direct access
    requireAuth: authMiddlewares.requireAuth,
    requireGuest: authMiddlewares.requireGuest,
    requireRole: authMiddlewares.requireRole,
    requirePermission: permissionMiddlewares.requirePermission,
    navigationLogger: routerMiddlewares.navigationLogger,
    analyticsTracker: routerMiddlewares.analyticsTracker,
    scrollToTop: routerMiddlewares.scrollToTop,
    validateParams: routerMiddlewares.validateParams,
    withData: dataMiddlewares.withData,
    csrfProtection: securityMiddlewares.csrfProtection,
    rateLimit: securityMiddlewares.rateLimit,
    errorHandler: errorMiddlewares.errorHandler,
    withRetry: errorMiddlewares.withRetry
};

// Register middlewares with VaniJS if available
if (typeof window !== 'undefined' && window.vani) {
    Object.entries(vaniMiddlewares).forEach(([name, middleware]) => {
        if (typeof middleware === 'function') {
            window.vani[name] = middleware;
        }
    });
    
    // Register category access
    window.vani.middleware = vaniMiddlewares;
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = vaniMiddlewares;
}

// Export for ES modules
if (typeof window !== 'undefined') {
    window.vaniMiddlewares = vaniMiddlewares;
}

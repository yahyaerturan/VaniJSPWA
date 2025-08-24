// app.js - Production Ready VaniJS Application
import { vani } from './vanijs.js';
import { vaniRouter } from './router.js';
import { vaniMiddlewares } from './middleware.js';
import { vaniPluginSystem } from './plugins.js';

// ==================== APPLICATION CONFIGURATION ====================
const APP_CONFIG = {
    name: 'VaniJS Production App',
    version: '2.0.0',
    api: {
        baseURL: import.meta.env.VITE_API_URL ?? '/api',
        timeout: 10000,
        retryAttempts: 3
    },
    features: {
        offline: true,
        analytics: true,
        errorTracking: true,
        performanceMonitoring: true
    },
    theme: {
        primary: '#2563eb',
        darkMode: false
    }
};

// ==================== SERVICE WORKER REGISTRATION ====================
async function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        try {
            const registration = await navigator.serviceWorker.register(`/sw.js?ver=${APP_CONFIG.version}`, {
                scope: '/',
                updateViaCache: 'none'
            });

            console.log('✅ Service Worker registered:', registration);

            // Listen for updates
            registration.addEventListener('updatefound', () => {
                const newWorker = registration.installing;
                console.log('🔄 New Service Worker found');

                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed') {
                        if (navigator.serviceWorker.controller) {
                            // New update available
                            showUpdateAvailable();
                        } else {
                            // First installation
                            console.log('✅ Content is cached for offline use.');
                        }
                    }
                });
            });

            // Handle messages from SW
            navigator.serviceWorker.addEventListener('message', (event) => {
                handleSWMessage(event.data);
            });

            return registration;
        } catch (error) {
            console.error('❌ Service Worker registration failed:', error);
            vani.pluginSystem?.executeHook('sw:registration-failed', { error });
        }
    }
}

function showUpdateAvailable() {
    if (vani.pluginSystem) {
        vani.pluginSystem.executeHook('sw:update-available');
    }

    // Show update notification
    if (confirm('A new version is available! Reload to update?')) {
        window.location.reload();
    }
}

function handleSWMessage(message) {
    switch (message.type) {
        case 'SW_ACTIVATED':
            console.log('✅ Service Worker activated:', message.version);
            break;
            
        case 'SW_ERROR':
            console.error('❌ Service Worker error:', message.error);
            vani.pluginSystem?.executeHook('sw:error', message.error);
            break;
    }
}

// ==================== CORE COMPONENTS ====================

// Main App Layout Component
vani.defineComponent('AppLayout', ({ vani, props, t }) => {
    const [state, setState] = vani.useState({
        sidebarOpen: false,
        theme: APP_CONFIG.theme.darkMode ? 'dark' : 'light',
        notifications: []
    });

    const toggleSidebar = () => {
        setState({ sidebarOpen: !state.sidebarOpen });
    };

    const toggleTheme = () => {
        const newTheme = state.theme === 'light' ? 'dark' : 'light';
        setState({ theme: newTheme });
        document.documentElement.setAttribute('data-theme', newTheme);
        vani.setConfig('app', 'theme', newTheme);
    };

    return vani.createElement('div', { className: `app-layout theme-${state.theme}` },
        // Header
        vani.createElement('header', { className: 'app-header' },
            vani.createElement('button', { 
                className: 'sidebar-toggle',
                onClick: toggleSidebar
            }, '☰'),
            
            vani.createElement('h1', { className: 'app-title' }, 
                APP_CONFIG.name
            ),
            
            vani.createElement('div', { className: 'header-actions' },
                vani.createElement('button', {
                    className: 'theme-toggle',
                    onClick: toggleTheme
                }, state.theme === 'light' ? '🌙' : '☀️'),
                
                vani.isAuthenticated() ?
                    vani.createElement('div', { className: 'user-menu' },
                        vani.createElement('span', { className: 'user-name' }, 
                            vani.auth.user?.name
                        ),
                        vani.createElement('button', {
                            onClick: () => vani.auth.logout()
                        }, t('logout'))
                    ) :
                    vani.createElement('button', {
                        onClick: () => vani.navigate('/login')
                    }, t('login'))
            )
        ),

        // Main Content
        vani.createElement('main', { className: 'app-main' },
            vani.createElement('div', { className: 'content-wrapper' },
                props.children
            )
        ),

        // Footer
        vani.createElement('footer', { className: 'app-footer' },
            vani.createElement('p', {}, 
                `© 2024 ${APP_CONFIG.name} v${APP_CONFIG.version}`
            )
        )
    );
});

// Dashboard Component
vani.defineComponent('Dashboard', ({ vani, t }) => {
    const [state, setState] = vani.useState({
        loading: true,
        stats: null,
        recentActivity: []
    });

    vani.pluginSystem?.executeHook('dashboard:init');

    // Load dashboard data
    const loadData = async () => {
        try {
            setState({ loading: true });
            
            const [stats, activity] = await Promise.all([
                fetch('/api/dashboard/stats').then(r => r.json()),
                fetch('/api/dashboard/activity').then(r => r.json())
            ]);

            setState({
                loading: false,
                stats,
                recentActivity: activity
            });

            vani.pluginSystem?.executeHook('dashboard:data-loaded', { stats, activity });
        } catch (error) {
            console.error('Failed to load dashboard data:', error);
            setState({ loading: false });
            vani.pluginSystem?.executeHook('dashboard:load-error', { error });
        }
    };

    // Load data on component mount
    vani.useEffect(() => {
        loadData();
    }, []);

    if (state.loading) {
        return vani.createElement('div', { className: 'loading' }, t('loading'));
    }

    return vani.createElement('div', { className: 'dashboard' },
        vani.createElement('h2', {}, t('dashboard.title')),
        
        vani.createElement('div', { className: 'stats-grid' },
            state.stats && Object.entries(state.stats).map(([key, value]) =>
                vani.createElement('div', { key, className: 'stat-card' },
                    vani.createElement('h3', {}, t(`dashboard.${key}`)),
                    vani.createElement('p', { className: 'stat-value' }, value)
                )
            )
        ),

        vani.createElement('div', { className: 'recent-activity' },
            vani.createElement('h3', {}, t('dashboard.recent_activity')),
            vani.createElement('ul', {},
                state.recentActivity.map((item, index) =>
                    vani.createElement('li', { key: index },
                        `${item.action} - ${new Date(item.timestamp).toLocaleString()}`
                    )
                )
            )
        )
    );
});

// Login Component
vani.defineComponent('LoginForm', ({ vani, t }) => {
    const [state, setState] = vani.useState({
        email: '',
        password: '',
        loading: false,
        error: null
    });

    const handleSubmit = async (e) => {
        e.preventDefault();
        setState({ loading: true, error: null });

        try {
            const success = await vani.auth.login({
                email: state.email,
                password: state.password
            });

            if (success) {
                vani.pluginSystem?.executeHook('auth:login-success');
                vani.navigate('/dashboard');
            } else {
                setState({ 
                    loading: false, 
                    error: t('login.invalid_credentials') 
                });
                vani.pluginSystem?.executeHook('auth:login-failed');
            }
        } catch (error) {
            setState({ 
                loading: false, 
                error: t('login.network_error') 
            });
            vani.pluginSystem?.executeHook('auth:login-error', { error });
        }
    };

    return vani.createElement('form', { onSubmit: handleSubmit, className: 'login-form' },
        vani.createElement('h2', {}, t('login.title')),
        
        state.error && 
            vani.createElement('div', { className: 'error-message' }, state.error),

        vani.createElement('div', { className: 'form-group' },
            vani.createElement('label', {}, t('login.email')),
            vani.createElement('input', {
                type: 'email',
                value: state.email,
                onChange: (e) => setState({ email: e.target.value }),
                required: true
            })
        ),

        vani.createElement('div', { className: 'form-group' },
            vani.createElement('label', {}, t('login.password')),
            vani.createElement('input', {
                type: 'password',
                value: state.password,
                onChange: (e) => setState({ password: e.target.value }),
                required: true
            })
        ),

        vani.createElement('button', { 
            type: 'submit', 
            disabled: state.loading,
            className: 'login-button'
        }, state.loading ? t('login.loading') : t('login.submit'))
    );
});

// ==================== ROUTE DEFINITIONS ====================

// Public routes
vani.defineRoute('/', 'Dashboard', {}, [
    vaniMiddlewares.auth.requireAuth,
    vaniMiddlewares.router.navigationLogger
]);

vani.defineRoute('/login', 'LoginForm', {}, [
    vaniMiddlewares.auth.requireGuest,
    vaniMiddlewares.router.scrollToTop
]);

vani.defineRoute('/register', 'RegisterForm', {}, [
    vaniMiddlewares.auth.requireGuest
]);

// Protected routes
vani.defineRoute('/dashboard', 'Dashboard', {}, [
    vaniMiddlewares.auth.requireAuth,
    vaniMiddlewares.router.navigationLogger,
    vaniMiddlewares.data.withData(() => 
        fetch('/api/dashboard/data').then(r => r.json()),
        { cacheKey: 'dashboard_data', ttl: 300000 }
    )
]);

vani.defineRoute('/profile', 'UserProfile', {}, [
    vaniMiddlewares.auth.requireAuth,
    vaniMiddlewares.router.validateParams({
        id: { required: false, pattern: /^\d+$/ }
    })
]);

vani.defineRoute('/settings', 'Settings', {}, [
    vaniMiddlewares.auth.requireAuth,
    vaniMiddlewares.permission.requirePermission('settings_access')
]);

// Admin routes
vani.defineRoute('/admin', 'AdminDashboard', {}, [
    vaniMiddlewares.auth.requireAuth,
    vaniMiddlewares.auth.requireRole('admin'),
    vaniMiddlewares.permission.requireAllPermissions('admin_access', 'user_management')
]);

// Error routes
vani.defineRoute('/404', 'NotFoundPage');
vani.defineRoute('/500', 'ErrorPage');
vani.defineRoute('/unauthorized', 'UnauthorizedPage');
vani.defineRoute('/offline', 'OfflinePage');

// ==================== INTERNATIONALIZATION ====================

// English translations
vani.setTranslations('en', {
    'app.title': 'VaniJS Production App',
    'login.title': 'Sign In',
    'login.email': 'Email Address',
    'login.password': 'Password',
    'login.submit': 'Sign In',
    'login.loading': 'Signing in...',
    'login.invalid_credentials': 'Invalid email or password',
    'login.network_error': 'Network error. Please try again.',
    'logout': 'Logout',
    'dashboard.title': 'Dashboard',
    'dashboard.users': 'Total Users',
    'dashboard.orders': 'Total Orders',
    'dashboard.revenue': 'Total Revenue',
    'dashboard.recent_activity': 'Recent Activity',
    'loading': 'Loading...',
    'error.general': 'Something went wrong. Please try again.',
    'error.offline': 'You are currently offline. Please check your connection.'
});

// Spanish translations
vani.setTranslations('es', {
    'app.title': 'Aplicación VaniJS',
    'login.title': 'Iniciar Sesión',
    'login.email': 'Correo Electrónico',
    'login.password': 'Contraseña',
    'login.submit': 'Iniciar Sesión',
    'login.loading': 'Iniciando sesión...',
    'login.invalid_credentials': 'Email o contraseña inválidos',
    'login.network_error': 'Error de red. Por favor, intente nuevamente.',
    'logout': 'Cerrar Sesión',
    'dashboard.title': 'Panel de Control',
    'dashboard.users': 'Usuarios Totales',
    'dashboard.orders': 'Órdenes Totales',
    'dashboard.revenue': 'Ingresos Totales',
    'dashboard.recent_activity': 'Actividad Reciente',
    'loading': 'Cargando...',
    'error.general': 'Algo salió mal. Por favor, intente nuevamente.',
    'error.offline': 'Estás desconectado. Por favor, verifica tu conexión.'
});

// ==================== APPLICATION INITIALIZATION ====================

async function initializeApp() {
    console.log('🚀 Initializing VaniJS Application...');
    
    try {
        // Initialize framework
        vani.init();
        
        // Initialize router
        vaniRouter.init('app');
        
        // Register service worker
        if (APP_CONFIG.features.offline) {
            await registerServiceWorker();
        }
        
        // Load user preferences
        loadUserPreferences();
        
        // Setup global error handling
        setupErrorHandling();
        
        // Setup performance monitoring
        setupPerformanceMonitoring();
        
        // Setup analytics
        if (APP_CONFIG.features.analytics) {
            setupAnalytics();
        }
        
        console.log('✅ Application initialized successfully');
        
        // Track app start
        vani.pluginSystem?.executeHook('app:started', {
            config: APP_CONFIG,
            timestamp: Date.now()
        });
        
    } catch (error) {
        console.error('❌ Application initialization failed:', error);
        vani.pluginSystem?.executeHook('app:init-failed', { error });
        
        // Show error page
        vani.navigate('/500');
    }
}

function loadUserPreferences() {
    const savedTheme = vani.getConfig('app', 'theme');
    const savedLanguage = localStorage.getItem('preferredLanguage');
    
    if (savedTheme) {
        document.documentElement.setAttribute('data-theme', savedTheme);
    }
    
    if (savedLanguage && vani.i18n[savedLanguage]) {
        vani.setLanguage(savedLanguage);
    }
}

function setupErrorHandling() {
    // Global error handler
    window.addEventListener('error', (event) => {
        vani.pluginSystem?.executeHook('app:global-error', {
            error: event.error,
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno
        });
    });
    
    // Unhandled rejections
    window.addEventListener('unhandledrejection', (event) => {
        vani.pluginSystem?.executeHook('app:unhandled-rejection', {
            reason: event.reason
        });
    });
}

function setupPerformanceMonitoring() {
    if (APP_CONFIG.features.performanceMonitoring) {
        // Monitor Core Web Vitals
        if ('PerformanceObserver' in window) {
            const observer = new PerformanceObserver((list) => {
                list.getEntries().forEach(entry => {
                    vani.pluginSystem?.executeHook('performance:metric', {
                        name: entry.name,
                        value: entry.startTime,
                        type: 'web-vital'
                    });
                });
            });
            
            observer.observe({ entryTypes: ['navigation', 'resource', 'paint'] });
        }
    }
}

function setupAnalytics() {
    if (APP_CONFIG.features.analytics) {
        // Initialize analytics services
        const GA_ID = import.meta.env.VITE_GA_ID;
        if (typeof gtag !== 'undefined' && GA_ID) {
            gtag('config', GA_ID, {
                app_name: APP_CONFIG.name,
                app_version: APP_CONFIG.version
            });
        }
        
        // Track app install
        window.addEventListener('appinstalled', () => {
            vani.pluginSystem?.executeHook('analytics:app-installed');
        });
    }
}

// ==================== UTILITY FUNCTIONS ====================

// Network status monitoring
function setupNetworkMonitor() {
    const updateOnlineStatus = () => {
        const isOnline = navigator.onLine;
        document.body.classList.toggle('online', isOnline);
        document.body.classList.toggle('offline', !isOnline);
        
        vani.pluginSystem?.executeHook('network:status-change', { isOnline });
        
        if (isOnline) {
            // Sync data when coming back online
            vani.pluginSystem?.executeHook('network:online');
        }
    };
    
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    updateOnlineStatus(); // Initial check
}

// Periodic data sync
function setupDataSync() {
    setInterval(async () => {
        if (navigator.onLine) {
            try {
                await vani.pluginSystem?.executeHook('data:sync');
            } catch (error) {
                console.error('Data sync failed:', error);
            }
        }
    }, 300000); // Sync every 5 minutes
}

// ==================== APPLICATION START ====================

// Start the application when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}

// Export for testing and debugging
if (typeof window !== 'undefined') {
    window.vaniApp = {
        vani,
        router: vaniRouter,
        middlewares: vaniMiddlewares,
        plugins: vaniPluginSystem,
        config: APP_CONFIG,
        utils: {
            initializeApp,
            registerServiceWorker,
            setupNetworkMonitor
        }
    };
}

// Handle beforeunload for cleanup
window.addEventListener('beforeunload', () => {
    vani.pluginSystem?.executeHook('app:beforeunload');
});

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        vani,
        vaniRouter,
        vaniMiddlewares,
        vaniPluginSystem,
        APP_CONFIG
    };
}
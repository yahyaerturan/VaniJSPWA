// mock-api.js - simple mock API for authentication
export function setupMockApi() {
  const users = [
    { email: 'user@example.com', password: 'password123', role: 'user' }
  ];

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input, init = {}) => {
    if (typeof input === 'string' && input.startsWith('/api')) {
      if (input === '/api/login' && (init.method || 'GET').toUpperCase() === 'POST') {
        try {
          const { email, password } = JSON.parse(init.body || '{}');
          const user = users.find(u => u.email === email && u.password === password);
          if (user) {
            return new Response(
              JSON.stringify({
                user: { email: user.email, role: user.role },
                tokens: {
                  access: 'mock-jwt-token',
                  refresh: 'mock-refresh-token'
                }
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }
          return new Response(
            JSON.stringify({ message: 'Invalid credentials' }),
            { status: 401, headers: { 'Content-Type': 'application/json' } }
          );
        } catch (err) {
          return new Response(
            JSON.stringify({ message: 'Bad Request' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }

      return new Response(
        JSON.stringify({ message: 'Not Found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return originalFetch(input, init);
  };
}

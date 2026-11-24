const PROD_API_FALLBACK = 'https://careerlens-ai-bakend.onrender.com';
const isLocalHost =
  typeof window !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);

export const API_BASE_URL = (
  import.meta.env.VITE_API_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  (isLocalHost ? 'http://localhost:8000' : PROD_API_FALLBACK)
).replace(/\/+$/, '');

/**
 * Turn any failed response into a readable message.
 * Render returns HTML (502/503) while the free instance is waking up or restarting,
 * so never assume the body is JSON.
 */
export const readErrorMessage = async (response, fallback = 'Something went wrong') => {
  let data = null;
  try {
    data = await response.clone().json();
  } catch {
    // non-JSON body
  }
  if (data) {
    if (typeof data.detail === 'string') return data.detail;
    if (Array.isArray(data.detail)) return data.detail.map((d) => d.msg || String(d)).join(', ');
    if (data.message) return data.message;
  }
  if ([502, 503, 504].includes(response.status)) {
    return 'The server is starting up or busy. Please wait a few seconds and try again.';
  }
  return `${fallback} (HTTP ${response.status})`;
};

const NETWORK_ERROR_MESSAGE =
  'Cannot reach the server. It may be waking up (this can take up to a minute) — please try again.';

/**
 * Core API request handler
 */
const apiRequest = async (endpoint, options = {}) => {
  const url = `${API_BASE_URL}${endpoint}`;

  const config = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  };

  // Add auth token if available
  const token = localStorage.getItem('careerlens_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  // Retry once on network failure / gateway errors (Render cold start).
  let response;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await fetch(url, config);
    } catch {
      response = null;
    }
    if (response && ![502, 503, 504].includes(response.status)) break;
    if (attempt === 0) await new Promise((r) => setTimeout(r, 3000));
  }

  if (!response) {
    throw { status: 0, message: NETWORK_ERROR_MESSAGE, errors: [] };
  }

  if (!response.ok) {
    throw {
      status: response.status,
      message: await readErrorMessage(response),
      errors: [],
    };
  }

  try {
    return await response.json();
  } catch {
    throw { status: response.status, message: 'Unexpected response from server.', errors: [] };
  }
};

/**
 * Login user
 */
export const loginUser = async (email, password) => {
  const data = await apiRequest('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: email.trim(), password }),
  });

  if (data.data?.token) {
    localStorage.setItem('careerlens_token', data.data.token);
    localStorage.setItem('careerlens_user', JSON.stringify(data.data.user));
  }

  return data;
};

/**
 * Signup user
 */
export const signupUser = async (name, email, password, confirmPassword) => {
  const data = await apiRequest('/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ name: name.trim(), email: email.trim(), password, confirmPassword }),
  });

  if (data.data?.token) {
    localStorage.setItem('careerlens_token', data.data.token);
    localStorage.setItem('careerlens_user', JSON.stringify(data.data.user));
  }

  return data;
};

/**
 * Get current user profile
 */
export const getCurrentUser = async () => {
  return apiRequest('/auth/me');
};

/**
 * Logout user
 */
export const logoutUser = () => {
  localStorage.removeItem('careerlens_token');
  localStorage.removeItem('careerlens_user');
};

/**
 * Check if user is authenticated
 */
export const isAuthenticated = () => {
  return !!localStorage.getItem('careerlens_token');
};

/**
 * Get stored user data
 */
export const getStoredUser = () => {
  try {
    const user = localStorage.getItem('careerlens_user');
    return user ? JSON.parse(user) : null;
  } catch {
    return null;
  }
};

export default apiRequest;

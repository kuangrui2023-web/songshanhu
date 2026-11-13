/* Customer email accounts: sign up / sign in / refresh / sign out / password reset.
   The session lives under its own storage key so it never touches the admin
   session or the receipt-based local visitor profile. */
(function () {
  'use strict';

  const STORAGE_KEY = 'songshanhu_customer_session_v1';
  const listeners = new Set();
  let refreshPromise = null;

  const config = () => window.__SITE_BACKEND__ || {};
  const base = () => String(config().url || '').replace(/\/$/, '');
  const key = () => String(config().key || '');

  function normalize(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.access_token !== 'string' || !raw.access_token) return null;
    if (typeof raw.refresh_token !== 'string' || !raw.refresh_token) return null;
    return {
      access_token: raw.access_token,
      refresh_token: raw.refresh_token,
      expires_at: Number(raw.expires_at) || 0,
      user: {
        id: String(raw.user && raw.user.id || ''),
        email: String(raw.user && raw.user.email || '')
      },
      saved_at: Number(raw.saved_at) || Date.now()
    };
  }

  function read() {
    try { return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')); }
    catch (_) { return null; }
  }

  function write(session) {
    try {
      if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
      else localStorage.removeItem(STORAGE_KEY);
    } catch (_) { /* 隐私模式或空间不足时只在本次页面有效 */ }
  }

  function emit(reason) {
    const user = read() ? read().user : null;
    listeners.forEach(listener => { try { listener(user, reason); } catch (_) { } });
    try {
      window.dispatchEvent(new CustomEvent('songshanhu:authchange', { detail: { user, reason } }));
    } catch (_) { }
  }

  function sessionFrom(data, previous) {
    const payload = data && data.session && data.session.access_token ? data.session : data;
    if (!payload || !payload.access_token || !payload.refresh_token) return null;
    return normalize({
      access_token: payload.access_token,
      refresh_token: payload.refresh_token,
      expires_at: Date.now() + (Number(payload.expires_in) || 3600) * 1000,
      user: {
        id: payload.user && payload.user.id || previous && previous.user && previous.user.id || '',
        email: payload.user && payload.user.email || previous && previous.user && previous.user.email || ''
      },
      saved_at: Date.now()
    });
  }

  function messageFor(status, data) {
    const code = String(data && (data.code || data.error_code) || '');
    const raw = String(data && (data.msg || data.error_description || data.message) || '');
    if (status === 429 || code.indexOf('rate_limit') > -1) return '操作过于频繁，请稍后再试。';
    switch (code) {
      case 'invalid_credentials': return '邮箱或密码不正确。';
      case 'email_not_confirmed': return '该邮箱还没有完成验证，请查收验证邮件。';
      case 'user_already_exists':
      case 'email_exists': return '该邮箱已注册，请直接登录或使用「忘记密码」。';
      case 'weak_password': return '密码强度不足，请至少使用 8 位字符。';
      case 'same_password': return '新密码不能与当前密码相同。';
      case 'signup_disabled': return '暂未开放邮箱注册，请联系招商顾问。';
      case 'email_address_invalid': return '邮箱格式不正确。';
      case 'over_email_send_rate_limit': return '邮件发送过于频繁，请稍后再试。';
      case 'otp_expired':
      case 'token_expired': return '重置链接已失效，请重新获取。';
      case 'session_not_found': return '登录已失效，请重新登录。';
    }
    if (/invalid login credentials/i.test(raw)) return '邮箱或密码不正确。';
    if (/already registered|already exists/i.test(raw)) return '该邮箱已注册，请直接登录或使用「忘记密码」。';
    if (/password.*(short|weak|characters)/i.test(raw)) return '密码强度不足，请至少使用 8 位字符。';
    if (status === 401) return '登录已失效，请重新登录。';
    if (status === 403) return '没有权限执行此操作。';
    return raw || '操作未完成，请稍后重试。';
  }

  async function request(path, options) {
    const opts = options || {};
    const url = base();
    if (!url || !key()) throw new Error('账号服务尚未连接，请稍后重试。');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeout || 20000);
    const headers = { apikey: key() };
    if (opts.token) headers.Authorization = 'Bearer ' + opts.token;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    try {
      const response = await fetch(url + path, {
        method: opts.method || 'GET',
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
        cache: 'no-store'
      });
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
      if (!response.ok) {
        const error = new Error(messageFor(response.status, data));
        error.status = response.status;
        error.code = String(data && (data.code || data.error_code) || '');
        throw error;
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('连接超时，请检查网络后重试。');
      if (error instanceof TypeError) throw new Error('网络连接失败，请检查网络后重试。');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function current() { return read(); }
  function currentUser() { const session = read(); return session ? session.user : null; }
  function isLoggedIn() { return Boolean(read()); }

  async function signIn(email, password) {
    const data = await request('/auth/v1/token?grant_type=password', {
      method: 'POST',
      body: { email: String(email).trim().toLowerCase(), password: String(password) }
    });
    const session = sessionFrom(data);
    if (!session) throw new Error('登录结果异常，请重试。');
    write(session);
    emit('signin');
    return session;
  }

  async function signUp(email, password) {
    const data = await request('/auth/v1/signup', {
      method: 'POST',
      body: { email: String(email).trim().toLowerCase(), password: String(password) }
    });
    const session = sessionFrom(data);
    if (session) {
      write(session);
      emit('signup');
      return { session, needsConfirm: false };
    }
    return { session: null, needsConfirm: true, user: data && data.user || data || null };
  }

  async function refreshSession(stale) {
    const latest = read();
    if (latest && latest.expires_at - Date.now() > 60000) return latest.access_token;
    const session = latest || stale;
    if (!session) return null;
    try {
      const data = await request('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        body: { refresh_token: session.refresh_token }
      });
      const next = sessionFrom(data, session);
      if (!next) throw new Error('登录已失效，请重新登录。');
      write(next);
      emit('refresh');
      return next.access_token;
    } catch (error) {
      const now = read();
      // 其他标签页已经换过新的 refresh token 时，直接用最新的。
      if (now && (now.refresh_token !== session.refresh_token || now.access_token !== session.access_token)) return now.access_token;
      // 只有服务端明确拒绝才退出登录；断网或超时保留登录态，等下次再试。
      if (error.status === 400 || error.status === 401 || error.status === 403) {
        write(null);
        emit('expired');
      }
      return null;
    }
  }

  async function accessToken() {
    const session = read();
    if (!session) return null;
    if (session.expires_at - Date.now() > 60000) return session.access_token;
    if (!refreshPromise) refreshPromise = refreshSession(session).finally(() => { refreshPromise = null; });
    return refreshPromise;
  }

  async function signOut() {
    const session = read();
    write(null);
    emit('signout');
    if (session && session.access_token) {
      try { await request('/auth/v1/logout', { method: 'POST', token: session.access_token, timeout: 8000 }); }
      catch (_) { /* 本地已经退出，远端失败不影响 */ }
    }
    return true;
  }

  function resetRedirectUrl() {
    const basePath = String(config().basePath || '').replace(/\/$/, '');
    return location.origin + basePath + '/experience/reset.html';
  }

  async function recover(email) {
    await request('/auth/v1/recover?redirect_to=' + encodeURIComponent(resetRedirectUrl()), {
      method: 'POST',
      body: { email: String(email).trim().toLowerCase() }
    });
    return true;
  }

  async function updatePassword(password) {
    const token = await accessToken();
    if (!token) throw new Error('登录已失效，请重新登录后再修改密码。');
    await request('/auth/v1/user', { method: 'PUT', token, body: { password: String(password) } });
    emit('password');
    return true;
  }

  async function listMyInquiries() {
    const token = await accessToken();
    if (!token) throw new Error('登录已失效，请重新登录。');
    const data = await request('/rest/v1/rpc/list_my_inquiries', { method: 'POST', token, body: {} });
    return Array.isArray(data) ? data : [];
  }

  function onChange(callback) {
    listeners.add(callback);
    return () => listeners.delete(callback);
  }

  window.addEventListener('storage', event => { if (event.key === STORAGE_KEY) emit('storage'); });

  window.SiteCustomerAuth = {
    current, currentUser, isLoggedIn, signIn, signUp, signOut,
    accessToken, recover, updatePassword, listMyInquiries, resetRedirectUrl, onChange
  };
})();

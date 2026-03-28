import { supabase, supabaseConfigError } from './supabase';

const PUSH_SESSION_KEY_PREFIX = 'push-subscription-ready:';
const PUSH_DEBUG_PREFIX = '[push]';

export type PushSyncStatus =
  | 'disabled'
  | 'enabled'
  | 'needs-permission'
  | 'unsupported'
  | 'denied';

export interface PushSyncResult {
  status: PushSyncStatus;
  permission: NotificationPermission | 'unsupported';
}

function debugPush(message: string, details?: unknown) {
  if (!import.meta.env.DEV) {
    return;
  }

  if (details === undefined) {
    console.info(PUSH_DEBUG_PREFIX, message);
    return;
  }

  console.info(PUSH_DEBUG_PREFIX, message, details);
}

function requireSupabase() {
  if (!supabase) {
    throw new Error(supabaseConfigError || 'Supabase is not configured.');
  }

  return supabase;
}

function getSessionStorageKey(userId: string) {
  return `${PUSH_SESSION_KEY_PREFIX}${userId}`;
}

function isBrowserPushSupported() {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    'Notification' in window &&
    'PushManager' in window &&
    'serviceWorker' in navigator
  );
}

function hasPushTransportSupport() {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    'PushManager' in window &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator
  );
}

function getSupportSnapshot() {
  return {
    hasNotificationApi:
      typeof window !== 'undefined' && 'Notification' in window,
    hasPushManager:
      typeof window !== 'undefined' && 'PushManager' in window,
    hasServiceWorker:
      typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
    isSecureContext:
      typeof window !== 'undefined' ? window.isSecureContext : false,
    permission:
      typeof window !== 'undefined' && 'Notification' in window
        ? Notification.permission
        : 'unsupported',
    vapidConfigured: Boolean(getVapidPublicKey()),
    serviceWorkerUrl:
      typeof window !== 'undefined' ? getServiceWorkerUrl() : 'sw.js',
    serviceWorkerScope: getServiceWorkerScope(),
  };
}

function getServiceWorkerScope() {
  return import.meta.env.BASE_URL || '/';
}

function getServiceWorkerUrl() {
  if (typeof window === 'undefined') {
    return 'sw.js';
  }

  return new URL(`${getServiceWorkerScope()}sw.js`, window.location.origin).toString();
}

function getVapidPublicKey() {
  return import.meta.env.VITE_PUSH_VAPID_PUBLIC_KEY?.trim() || '';
}

function urlBase64ToUint8Array(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index);
  }

  return outputArray;
}

function markSessionReady(userId: string) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.sessionStorage.setItem(getSessionStorageKey(userId), '1');
  } catch {
    // Ignore storage failures and keep the app usable.
  }
}

function hasSessionReadyFlag(userId: string) {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    return window.sessionStorage.getItem(getSessionStorageKey(userId)) === '1';
  } catch {
    return false;
  }
}

async function savePushSubscription(userId: string, subscription: PushSubscription) {
  const client = requireSupabase();
  debugPush('Saving push subscription to Supabase.', {
    endpoint: subscription.endpoint,
    userId,
  });
  const { error } = await client.from('push_subscriptions').upsert(
    {
      user_id: userId,
      subscription: subscription.toJSON(),
    },
    {
      onConflict: 'user_id',
    },
  );

  if (error) {
    throw new Error(`Unable to save the push subscription: ${error.message}`);
  }
}

export async function registerAppServiceWorker() {
  if (!isBrowserPushSupported()) {
    debugPush('Skipping service worker registration because push is unsupported.', getSupportSnapshot());
    return null;
  }

  debugPush('Registering push service worker.', getSupportSnapshot());

  return navigator.serviceWorker.register(getServiceWorkerUrl(), {
    scope: getServiceWorkerScope(),
  });
}

async function subscribeUserToPush(userId: string, registration: ServiceWorkerRegistration) {
  const existingSubscription = await registration.pushManager.getSubscription();
  debugPush('Existing push subscription lookup completed.', {
    hasExistingSubscription: Boolean(existingSubscription),
    userId,
  });
  const subscription =
    existingSubscription ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(getVapidPublicKey()),
    }));

  await savePushSubscription(userId, subscription);
  markSessionReady(userId);
}

export async function syncPushNotifications(
  userId: string,
  options?: { requestPermission?: boolean },
): Promise<PushSyncResult> {
  debugPush('Starting push sync.', {
    requestPermission: Boolean(options?.requestPermission),
    userId,
    ...getSupportSnapshot(),
  });

  const hasNotificationApi =
    typeof window !== 'undefined' && 'Notification' in window;
  if (!hasNotificationApi) {
    debugPush('Push sync result: unsupported because Notification API is unavailable.');
    return {
      status: 'unsupported',
      permission: 'unsupported',
    };
  }

  if (!hasPushTransportSupport()) {
    debugPush(
      'Push sync result: unsupported because the current origin or browser cannot use service workers and PushManager.',
      getSupportSnapshot(),
    );
    return {
      status: 'unsupported',
      permission: Notification.permission,
    };
  }

  if (!getVapidPublicKey()) {
    debugPush('Push sync result: disabled because VAPID public key is missing.');
    return {
      status: 'disabled',
      permission: Notification.permission,
    };
  }

  let permission = Notification.permission;
  if (permission === 'default' && options?.requestPermission) {
    debugPush(
      'Requesting notification permission from the browser before any async registration work.',
    );
    permission = await Notification.requestPermission();
    debugPush('Notification permission request completed.', {
      permission,
    });
  }

  if (permission === 'denied') {
    debugPush('Push sync result: permission denied by the browser.');
    return {
      status: 'denied',
      permission,
    };
  }

  if (permission !== 'granted') {
    debugPush('Push sync result: waiting for a user-triggered permission request.', {
      permission,
    });
    return {
      status: 'needs-permission',
      permission,
    };
  }

  if (hasSessionReadyFlag(userId)) {
    debugPush('Push sync result: already enabled for this session.', {
      userId,
    });
    return {
      status: 'enabled',
      permission,
    };
  }

  const registration = await registerAppServiceWorker();
  if (!registration) {
    debugPush('Push sync result: unsupported because service worker registration returned null.');
    return {
      status: 'unsupported',
      permission,
    };
  }

  await subscribeUserToPush(userId, registration);
  debugPush('Push sync result: enabled.', {
    userId,
  });

  return {
    status: 'enabled',
    permission,
  };
}

export async function sendClipSentPushNotification(targetUserId: string) {
  const client = requireSupabase();
  const { error } = await client.functions.invoke('send-push-notification', {
    body: {
      targetUserId,
    },
  });

  if (error) {
    throw new Error(`Unable to send the clip notification: ${error.message}`);
  }
}

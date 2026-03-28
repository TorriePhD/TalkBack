import { supabase, supabaseConfigError } from './supabase';

const PUSH_SESSION_KEY_PREFIX = 'push-subscription-ready:';

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
    return null;
  }

  return navigator.serviceWorker.register(getServiceWorkerUrl(), {
    scope: getServiceWorkerScope(),
  });
}

async function subscribeUserToPush(userId: string, registration: ServiceWorkerRegistration) {
  const existingSubscription = await registration.pushManager.getSubscription();
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
  if (!isBrowserPushSupported()) {
    return {
      status: 'unsupported',
      permission: 'unsupported',
    };
  }

  if (!getVapidPublicKey()) {
    return {
      status: 'disabled',
      permission: Notification.permission,
    };
  }

  const registration = await registerAppServiceWorker();
  if (!registration) {
    return {
      status: 'unsupported',
      permission: 'unsupported',
    };
  }

  if (Notification.permission === 'granted' && hasSessionReadyFlag(userId)) {
    return {
      status: 'enabled',
      permission: 'granted',
    };
  }

  let permission = Notification.permission;
  if (permission === 'default' && options?.requestPermission) {
    permission = await Notification.requestPermission();
  }

  if (permission === 'denied') {
    return {
      status: 'denied',
      permission,
    };
  }

  if (permission !== 'granted') {
    return {
      status: 'needs-permission',
      permission,
    };
  }

  await subscribeUserToPush(userId, registration);

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

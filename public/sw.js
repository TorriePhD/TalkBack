function getScopedUrl(path) {
  return new URL(path, self.registration.scope).toString();
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  const defaultUrl = getScopedUrl('./');
  const defaultIcon = getScopedUrl('icon-192.png');
  let data = {
    title: 'Your turn!',
    body: 'Your friend sent you a clip \uD83C\uDFA4',
    icon: defaultIcon,
    badge: defaultIcon,
    url: defaultUrl,
  };

  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch {
      try {
        data = { ...data, body: event.data.text() || data.body };
      } catch {
        // Keep the default payload.
      }
    }
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || defaultIcon,
      badge: data.badge || defaultIcon,
      data: {
        url: data.url || defaultUrl,
      },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || getScopedUrl('./');

  event.waitUntil(
    (async () => {
      const windowClients = await clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      for (const windowClient of windowClients) {
        if (windowClient.url.startsWith(self.registration.scope)) {
          await windowClient.focus();
          if ('navigate' in windowClient) {
            await windowClient.navigate(targetUrl);
          }
          return;
        }
      }

      await clients.openWindow(targetUrl);
    })(),
  );
});

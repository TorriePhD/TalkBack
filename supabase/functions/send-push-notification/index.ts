import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import webpush from 'npm:web-push@3.6.7';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface SendPushRequest {
  targetUserId?: string;
  target_user_id?: string;
  user_id?: string;
}

interface PushSubscriptionRow {
  id: string;
  subscription: webpush.PushSubscription;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function getRequiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function isStatusError(error: unknown): error is { statusCode?: number } {
  return typeof error === 'object' && error !== null && 'statusCode' in error;
}

function getTargetUserId(body: SendPushRequest) {
  return body.targetUserId ?? body.target_user_id ?? body.user_id ?? null;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders,
    });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ sent: false, error: 'Method not allowed.' }, 405);
  }

  try {
    const supabaseUrl = getRequiredEnv('SUPABASE_URL');
    const supabaseAnonKey = getRequiredEnv('SUPABASE_ANON_KEY');
    const supabaseServiceRoleKey = getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY');
    const vapidPublicKey = getRequiredEnv('VAPID_PUBLIC_KEY');
    const vapidPrivateKey = getRequiredEnv('VAPID_PRIVATE_KEY');
    const vapidSubject =
      Deno.env.get('VAPID_SUBJECT')?.trim() || 'mailto:notifications@example.com';

    const authorization = request.headers.get('Authorization');
    if (!authorization) {
      return jsonResponse({ sent: false, error: 'Unauthorized.' }, 401);
    }

    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: authorization,
        },
      },
    });
    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser();

    if (authError || !user) {
      return jsonResponse({ sent: false, error: 'Unauthorized.' }, 401);
    }

    const targetUserId = getTargetUserId((await request.json()) as SendPushRequest);
    if (!targetUserId || typeof targetUserId !== 'string') {
      return jsonResponse({ sent: false, error: 'targetUserId is required.' }, 400);
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);
    const { data, error } = await adminClient
      .from('push_subscriptions')
      .select('id, subscription')
      .eq('user_id', targetUserId)
      .maybeSingle<PushSubscriptionRow>();

    if (error) {
      throw new Error(`Unable to load the push subscription: ${error.message}`);
    }

    if (!data?.subscription) {
      return jsonResponse({ sent: false, reason: 'subscription_not_found' });
    }

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

    try {
      await webpush.sendNotification(
        data.subscription,
        JSON.stringify({
          title: 'Your turn!',
          body: 'Your friend sent you a clip \uD83C\uDFA4',
        }),
      );
    } catch (error) {
      if (isStatusError(error) && (error.statusCode === 404 || error.statusCode === 410)) {
        await adminClient.from('push_subscriptions').delete().eq('id', data.id);

        return jsonResponse({
          sent: false,
          reason: 'subscription_expired',
        });
      }

      throw error;
    }

    return jsonResponse({ sent: true });
  } catch (error) {
    return jsonResponse(
      {
        sent: false,
        error: error instanceof Error ? error.message : 'Unknown error.',
      },
      500,
    );
  }
});

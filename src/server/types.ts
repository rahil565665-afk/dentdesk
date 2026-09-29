export type UserRole = 'platform_admin' | 'owner' | 'manager' | 'viewer';

export interface AppUser {
  id: string;
  manus_open_id: string;
  email: string;
  display_name: string;
  is_platform_admin: boolean;
  is_active: boolean;
}

export interface Company {
  id: string;
  slug: string;
  name: string;
  business_type: string;
  is_active: boolean;
  timezone: string;
  receptionist_config: {
    greeting?: string;
    voice_output_mode?: 'native' | 'cartesia';
    faqs?: Array<{ question: string; answer: string }>;
    transfer_enabled?: boolean;
    [key: string]: unknown;
  };
  created_at?: string;
}

export interface AppointmentToolInput {
  start?: string;
  end?: string;
  timeZone?: string;
  eventTypeId?: number;
  eventTypeSlug?: string;
  username?: string;
  teamSlug?: string;
  organizationSlug?: string;
  name?: string;
  email?: string;
  phone?: string;
  bookingUid?: string;
  attendeeEmail?: string;
  attendeePhone?: string;
  reason?: string;
  appointmentType?: string;
  bookingUidToReschedule?: string;
}

export interface VoiceEvent {
  type: 'status' | 'audio' | 'transcript' | 'confirmation_required' | 'transfer_requested' | 'error' | 'call_ended';
  status?: 'listening' | 'processing' | 'speaking' | 'transfer_requested' | 'disconnected';
  data?: string;
  mimeType?: string;
  role?: 'user' | 'assistant' | 'tool';
  text?: string;
  requestId?: string;
  action?: string;
  summary?: string;
  reason?: string;
  message?: string;
}

export interface TenantProviderConfig {
  apiKey?: string;
  voiceId?: string;
  eventTypeId?: number;
  eventTypeSlug?: string;
  username?: string;
  teamSlug?: string;
  organizationSlug?: string;
  baseUrl?: string;
  supabaseUrl?: string;
  supabaseSecretKey?: string;
}

// Universal Calendar Integration System
import { FastifyInstance } from 'fastify';

// Calendar provider interfaces
interface CalendarProvider {
  name: string;
  checkAvailability(dateTime: string): Promise<CalendarSlot[]>;
  bookAppointment(dateTime: string, title: string, duration?: number): Promise<CalendarEvent>;
}

export interface CalendarSlot {
  start: string;
  end: string;
  available: boolean;
}

export interface CalendarEvent {
  id: string;
  start: string;
  end: string;
  title: string;
  provider: string;
}

// Calendar provider implementations
class GoogleCalendarProvider implements CalendarProvider {
  name = 'google';

  async checkAvailability(dateTime: string): Promise<CalendarSlot[]> {
    const parsed = await parseDateTime(dateTime);
    const auth = this.getGoogleAuth();

    const googleapis = require('googleapis');
    const calendar = googleapis.google.calendar({ version: 'v3', auth });

    // Check free/busy for the day
    const response = await calendar.freebusy.query({
      requestBody: {
        timeMin: `${parsed.date}T00:00:00Z`,
        timeMax: `${parsed.date}T23:59:59Z`,
        items: [{ id: 'primary' }]
      }
    });

    const busy = response.data.calendars?.primary?.busy || [];
    return generateAvailableSlots(parsed.date, busy);
  }

  async bookAppointment(dateTime: string, title: string, duration = 30): Promise<CalendarEvent> {
    const parsed = await parseDateTime(dateTime);
    const auth = this.getGoogleAuth();

    const googleapis = require('googleapis');
    const calendar = googleapis.google.calendar({ version: 'v3', auth });

    const event = {
      summary: title,
      start: { dateTime: `${parsed.date}T${parsed.time}:00`, timeZone: 'UTC' },
      end: {
        dateTime: `${parsed.date}T${addMinutes(parsed.time, duration)}:00`,
        timeZone: 'UTC'
      }
    };

    const response = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: event
    });

    return {
      id: response.data.id!,
      start: event.start.dateTime!,
      end: event.end.dateTime!,
      title: title,
      provider: 'google'
    };
  }

  private getGoogleAuth() {
    const googleapis = require('googleapis');
    const auth = new googleapis.google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
      },
      scopes: ['https://www.googleapis.com/auth/calendar']
    });
    return auth;
  }
}

class OutlookCalendarProvider implements CalendarProvider {
  name = 'outlook';

  async checkAvailability(dateTime: string): Promise<CalendarSlot[]> {
    const parsed = await parseDateTime(dateTime);
    const client = this.getOutlookClient();

    // Get busy times from Outlook
    const response = await client
      .api('/me/calendar/getSchedule')
      .post({
        schedules: ['primary'],
        startTime: {
          dateTime: `${parsed.date}T00:00:00`,
          timeZone: 'UTC'
        },
        endTime: {
          dateTime: `${parsed.date}T23:59:59`,
          timeZone: 'UTC'
        }
      });

    const busy = response.value[0]?.scheduleItems || [];
    return generateAvailableSlots(parsed.date, busy.map((item: any) => ({
      start: item.start.dateTime,
      end: item.end.dateTime
    })));
  }

  async bookAppointment(dateTime: string, title: string, duration = 30): Promise<CalendarEvent> {
    const parsed = await parseDateTime(dateTime);
    const client = this.getOutlookClient();

    const event = {
      subject: title,
      start: {
        dateTime: `${parsed.date}T${parsed.time}:00`,
        timeZone: 'UTC'
      },
      end: {
        dateTime: `${parsed.date}T${addMinutes(parsed.time, duration)}:00`,
        timeZone: 'UTC'
      }
    };

    const response = await client
      .api('/me/events')
      .post(event);

    return {
      id: response.id,
      start: event.start.dateTime,
      end: event.end.dateTime,
      title: title,
      provider: 'outlook'
    };
  }

  private getOutlookClient() {
    const { Client } = require('@microsoft/microsoft-graph-client');
    return Client.init({
      authProvider: (done: any) => {
        done(null, process.env.OUTLOOK_ACCESS_TOKEN);
      }
    });
  }
}

class CustomCalendarProvider implements CalendarProvider {
  name = 'custom';

  async checkAvailability(dateTime: string): Promise<CalendarSlot[]> {
    // Call custom calendar API
    const response = await fetch(process.env.CUSTOM_CALENDAR_API!, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.CUSTOM_CALENDAR_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ action: 'check', dateTime })
    });

    const data = await response.json();
    return data.slots || [];
  }

  async bookAppointment(dateTime: string, title: string, duration = 30): Promise<CalendarEvent> {
    // Call custom booking API
    const response = await fetch(process.env.CUSTOM_CALENDAR_API!, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.CUSTOM_CALENDAR_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ action: 'book', dateTime, title, duration })
    });

    const data = await response.json();
    return {
      id: data.eventId,
      start: data.start,
      end: data.end,
      title: title,
      provider: 'custom'
    };
  }
}

// Available calendar providers
const CALENDAR_PROVIDERS: Record<string, CalendarProvider> = {
  google: new GoogleCalendarProvider(),
  outlook: new OutlookCalendarProvider(),
  custom: new CustomCalendarProvider()
};

export async function setupCalendarTools(app: FastifyInstance) {

  // Check availability (any calendar provider)
  app.post('/tools/check-calendar', async (req, reply) => {
    const { dateTime, provider = 'google', duration = 30 } = req.body as {
      dateTime: string;
      provider?: string;
      duration?: number;
    };

    const calendar = CALENDAR_PROVIDERS[provider];
    if (!calendar) {
      return reply.code(400).send({
        error: `Unsupported calendar provider: ${provider}. Supported: ${Object.keys(CALENDAR_PROVIDERS).join(', ')}`
      });
    }

    try {
      const slots = await calendar.checkAvailability(dateTime);

      // Filter for the requested duration
      const availableSlots = slots.filter(slot => {
        const slotDuration = (new Date(slot.end).getTime() - new Date(slot.start).getTime()) / (1000 * 60);
        return slot.available && slotDuration >= duration;
      });

      return {
        available: availableSlots.length > 0,
        slots: availableSlots.map(s => `${formatTime(s.start)} - ${formatTime(s.end)}`),
        provider,
        duration,
        message: availableSlots.length > 0 ?
          `Available ${duration}-minute slots: ${availableSlots.map(s => formatTime(s.start)).join(', ')}` :
          `No ${duration}-minute slots available for the requested time`
      };
    } catch (error) {
      console.error(`Calendar check failed for ${provider}:`, error);
      return {
        available: false,
        error: `Could not check ${provider} calendar availability`,
        provider
      };
    }
  });

  // Book appointment (any calendar provider)
  app.post('/tools/book-appointment', async (req, reply) => {
    const {
      dateTime,
      title = 'Voice Bot Appointment',
      provider = 'google',
      duration = 30
    } = req.body as {
      dateTime: string;
      title?: string;
      provider?: string;
      duration?: number;
    };

    const calendar = CALENDAR_PROVIDERS[provider];
    if (!calendar) {
      return reply.code(400).send({
        error: `Unsupported calendar provider: ${provider}`
      });
    }

    try {
      const event = await calendar.bookAppointment(dateTime, title, duration);

      return {
        success: true,
        eventId: event.id,
        start: event.start,
        end: event.end,
        title: event.title,
        provider: event.provider,
        message: `Appointment "${title}" booked for ${formatTime(event.start)} - ${formatTime(event.end)}`
      };
    } catch (error) {
      console.error(`Appointment booking failed for ${provider}:`, error);
      return {
        success: false,
        error: `Could not book appointment on ${provider} calendar`,
        provider
      };
    }
  });

  // List available providers
  app.get('/tools/calendar-providers', async (req, reply) => {
    return {
      providers: Object.keys(CALENDAR_PROVIDERS),
      default: 'google'
    };
  });
}

// Helper functions

async function parseDateTime(naturalLanguage: string): Promise<{ date: string; time: string }> {
  // Use OpenAI to parse natural language date/time
  const { OpenAI } = await import('openai');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{
      role: 'user',
      content: `Parse this date/time: "${naturalLanguage}". Current time: ${new Date().toISOString()}. Return JSON: {"date":"YYYY-MM-DD","time":"HH:mm"}`
    }],
    response_format: { type: "json_object" }
  });

  const content = response.choices[0].message.content;
  return content ? JSON.parse(content) : { date: '', time: '' };
}

function generateAvailableSlots(date: string, busySlots: any[]): CalendarSlot[] {
  const slots: CalendarSlot[] = [];
  const workStart = 9; // 9 AM
  const workEnd = 17; // 5 PM
  const slotDuration = 30; // minutes

  for (let hour = workStart; hour < workEnd; hour++) {
    for (let minute = 0; minute < 60; minute += slotDuration) {
      const startTime = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
      const endTime = addMinutes(startTime, slotDuration);

      const slotStart = `${date}T${startTime}:00Z`;
      const slotEnd = `${date}T${endTime}:00Z`;

      // Check if this slot conflicts with busy times
      const isAvailable = !busySlots.some((busy: any) => {
        return slotStart < busy.end && slotEnd > busy.start;
      });

      slots.push({
        start: slotStart,
        end: slotEnd,
        available: isAvailable
      });
    }
  }

  return slots;
}

function addMinutes(time: string, minutes: number): string {
  const [hours, mins] = time.split(':').map(Number);
  const totalMinutes = hours * 60 + mins + minutes;
  const newHours = Math.floor(totalMinutes / 60);
  const newMinutes = totalMinutes % 60;
  return `${newHours.toString().padStart(2, '0')}:${newMinutes.toString().padStart(2, '0')}`;
}

function formatTime(dateTime: string): string {
  const date = new Date(dateTime);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}
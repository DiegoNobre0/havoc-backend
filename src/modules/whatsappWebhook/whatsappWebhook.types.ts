export interface WebhookMessagePayload {
  id: string;
  from: string;
  timestamp: string;
  type: 'text' | 'audio' | 'image' | 'interactive' | 'document' | 'unknown';
  text?: { body: string };
  audio?: { id: string; mime_type: string };
  image?: { id: string; mime_type: string; caption?: string };
  interactive?: {
    type: 'button_reply' | 'list_reply';
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string; description?: string };
  };
}

export interface ParsedMessage {
  messageId: string;
  phone: string;
  customerName: string; // ADICIONAR ISSO
  type: string;
  content: string;
  raw_payload: any;
}


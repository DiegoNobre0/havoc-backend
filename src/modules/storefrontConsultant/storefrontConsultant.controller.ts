import type { FastifyReply, FastifyRequest } from 'fastify';
import type {
  ConsultantAudioQuery,
  ConsultantSessionParams,
  ConsultantTokenHeaders,
  CreateConsultantMessage,
  CreateConsultantSession,
} from './storefrontConsultant.schemas.js';
import { StorefrontConsultantService } from './storefrontConsultant.service.js';
import {
  removeConsultantAudio,
  saveConsultantAudio,
  transcribeConsultantAudio,
} from './storefrontConsultant.audio.js';

export class StorefrontConsultantController {
  private readonly service = new StorefrontConsultantService();

  async createSession(
    request: FastifyRequest<{ Body: CreateConsultantSession }>,
    reply: FastifyReply,
  ) {
    return reply.status(201).send(await this.service.createSession(request.body.clientId));
  }

  async getSession(
    request: FastifyRequest<{
      Params: ConsultantSessionParams;
      Headers: ConsultantTokenHeaders;
    }>,
    reply: FastifyReply,
  ) {
    return reply.send(
      await this.service.getSession(
        request.params.sessionId,
        request.headers['x-consultant-token'],
      ),
    );
  }

  async endSession(
    request: FastifyRequest<{
      Params: ConsultantSessionParams;
      Headers: ConsultantTokenHeaders;
    }>,
    reply: FastifyReply,
  ) {
    await this.service.endSession(request.params.sessionId, request.headers['x-consultant-token']);
    return reply.status(204).send();
  }

  async sendMessage(
    request: FastifyRequest<{
      Params: ConsultantSessionParams;
      Headers: ConsultantTokenHeaders;
      Body: CreateConsultantMessage;
    }>,
    reply: FastifyReply,
  ) {
    return reply.send(
      await this.service.sendMessage(
        request.params.sessionId,
        request.headers['x-consultant-token'],
        request.body,
      ),
    );
  }

  async sendAudio(
    request: FastifyRequest<{
      Params: ConsultantSessionParams;
      Headers: ConsultantTokenHeaders;
      Querystring: ConsultantAudioQuery;
    }>,
    reply: FastifyReply,
  ) {
    const { sessionId } = request.params;
    const token = request.headers['x-consultant-token'];
    const existing = await this.service.getCompletedRequest(
      sessionId,
      token,
      request.query.requestId,
    );
    if (existing) return reply.send(existing);

    let tempPath: string | undefined;
    try {
      tempPath = await saveConsultantAudio(request);
      const transcript = await transcribeConsultantAudio(tempPath);
      const { itemType, itemId, itemSlug } = request.query;
      const item =
        itemType && itemId && itemSlug ? { type: itemType, id: itemId, slug: itemSlug } : undefined;

      return reply.send(
        await this.service.sendTranscribedMessage(sessionId, token, {
          content: transcript,
          requestId: request.query.requestId,
          context: { surface: request.query.surface, ...(item ? { item } : {}) },
        }),
      );
    } finally {
      await removeConsultantAudio(tempPath);
    }
  }
}

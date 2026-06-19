import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  HttpCode,
  HttpStatus,
  BadRequestException,
  HttpException,
  ConflictException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { ContactService } from './contact.service';

@ApiTags('contacts')
@Controller('sessions/:sessionId/contacts')
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  @Get()
  @ApiOperation({ summary: 'Get all contacts for a session' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiResponse({
    status: 200,
    description: 'List of contacts',
  })
  @ApiResponse({ status: 400, description: 'Session not ready' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async findAll(@Param('sessionId') sessionId: string) {
    return this.contactService.getContacts(sessionId);
  }

  @Get('check/:number')
  @ApiOperation({ summary: 'Check if a phone number exists on WhatsApp' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiParam({ name: 'number', description: 'Phone number to check (e.g., 628123456789)' })
  @ApiResponse({
    status: 200,
    description: 'Number existence check result',
  })
  async checkNumber(@Param('sessionId') sessionId: string, @Param('number') number: string) {
    const digits = number.replace(/\D/g, '');
    if (!digits) {
      throw new BadRequestException('Phone number must contain digits');
    }

    try {
      const whatsappId = await this.contactService.getNumberId(sessionId, digits);
      return {
        number: digits,
        exists: whatsappId !== null,
        whatsappId,
      };
    } catch (error) {
      if (error instanceof ConflictException) {
        const response = error.getResponse();
        const rawMessage =
          typeof response === 'string'
            ? response
            : (response as { message?: string | string[] }).message;
        const message = Array.isArray(rawMessage) ? rawMessage[0] : rawMessage ?? error.message;

        return {
          number: digits,
          exists: false,
          whatsappId: null,
          error: message,
          retryable: true,
          sessionNotReady: true,
        };
      }

      if (error instanceof HttpException) {
        throw error;
      }

      const message = error instanceof Error ? error.message : 'Number check failed';
      const retryable = /detached Frame|Evaluation failed|Target closed|Protocol error|Execution context was destroyed|not ready|not connected/i.test(
        message,
      );

      return {
        number: digits,
        exists: false,
        whatsappId: null,
        error: message,
        retryable,
      };
    }
  }

  @Get(':contactId')
  @ApiOperation({ summary: 'Get a specific contact by ID' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiParam({ name: 'contactId', description: 'Contact ID (e.g., 628xxx@c.us)' })
  @ApiResponse({
    status: 200,
    description: 'Contact details',
  })
  @ApiResponse({ status: 404, description: 'Contact not found' })
  async findOne(@Param('sessionId') sessionId: string, @Param('contactId') contactId: string) {
    return this.contactService.getContactById(sessionId, contactId);
  }

  // ========== Gap Quick Wins: Profile Picture, Block/Unblock ==========

  @Get(':contactId/profile-picture')
  @ApiOperation({ summary: 'Get profile picture URL for a contact' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiParam({ name: 'contactId', description: 'Contact ID (e.g., 628xxx@c.us)' })
  @ApiResponse({
    status: 200,
    description: 'Profile picture URL',
  })
  async getProfilePicture(@Param('sessionId') sessionId: string, @Param('contactId') contactId: string) {
    const url = await this.contactService.getProfilePicture(sessionId, contactId);
    return { url };
  }

  @Get(':contactId/phone')
  @ApiOperation({ summary: 'Resolve a contact id (e.g. an @lid) to a phone number — best-effort' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiParam({ name: 'contactId', description: 'Contact ID / JID to resolve (e.g., an @lid)' })
  @ApiResponse({
    status: 200,
    description: 'Resolved phone number (MSISDN digits), or null when the engine cannot map it',
  })
  async resolvePhone(@Param('sessionId') sessionId: string, @Param('contactId') contactId: string) {
    const phone = await this.contactService.resolveContactPhone(sessionId, contactId);
    return { contactId, phone };
  }

  @Post(':contactId/block')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Block a contact' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiParam({ name: 'contactId', description: 'Contact ID (e.g., 628xxx@c.us)' })
  @ApiResponse({
    status: 200,
    description: 'Contact blocked',
  })
  async blockContact(@Param('sessionId') sessionId: string, @Param('contactId') contactId: string) {
    await this.contactService.blockContact(sessionId, contactId);
    return { success: true, message: 'Contact blocked' };
  }

  @Delete(':contactId/block')
  @ApiOperation({ summary: 'Unblock a contact' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiParam({ name: 'contactId', description: 'Contact ID (e.g., 628xxx@c.us)' })
  @ApiResponse({
    status: 200,
    description: 'Contact unblocked',
  })
  async unblockContact(@Param('sessionId') sessionId: string, @Param('contactId') contactId: string) {
    await this.contactService.unblockContact(sessionId, contactId);
    return { success: true, message: 'Contact unblocked' };
  }
}

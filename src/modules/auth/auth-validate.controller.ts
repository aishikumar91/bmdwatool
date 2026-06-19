import { Controller, Post, Get, Headers, HttpCode, HttpStatus, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from './decorators/auth.decorators';
import { AuthService } from './auth.service';
import { createLogger } from '../../common/services/logger.service';

@ApiTags('auth')
@Controller('auth')
@SkipThrottle()
export class AuthValidateController {
  private readonly logger = createLogger('AuthValidateController');

  constructor(private readonly authService: AuthService) {}

  @Post('validate')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validate an API key' })
  @ApiHeader({ name: 'X-API-Key', description: 'API key to validate' })
  @ApiResponse({ status: 200, description: 'API key is valid' })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  async validate(@Headers('x-api-key') apiKey?: string): Promise<{ valid: boolean; role?: string }> {
    // This route is behind the global API-key guard, so in normal operation only a valid key
    // reaches this handler (a missing/invalid key 401s first) and the `valid:false` branches
    // below are unreachable. They are retained as defense-in-depth in case the guard
    // config ever changes — they are cheap and keep the endpoint safe to expose directly.
    if (!apiKey) {
      return { valid: false };
    }

    try {
      const keyEntity = await this.authService.validateApiKey(apiKey);
      if (keyEntity && keyEntity.isActive) {
        return { valid: true, role: keyEntity.role };
      }
      return { valid: false };
    } catch (error) {
      this.logger.warn('API key validation error', { error: error instanceof Error ? error.message : String(error) });
      return { valid: false };
    }
  }
}

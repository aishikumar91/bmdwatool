import { Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, In, Repository } from 'typeorm';
import { Message } from './entities/message.entity';
import { MessageBatch, BatchStatus } from './entities/message-batch.entity';
import { createLogger } from '../../common/services/logger.service';
import {
  autoClearAfterBroadcastEnabled,
  autoClearIntervalMinutes,
  autoClearMessageRetentionHours,
  autoClearSessionHistoryEnabled,
} from '../../config/anti-ban';

@Injectable()
export class SessionHistoryCleanupService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = createLogger('SessionHistoryCleanup');
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectRepository(Message, 'data')
    private readonly messageRepository: Repository<Message>,
    @InjectRepository(MessageBatch, 'data')
    private readonly batchRepository: Repository<MessageBatch>,
  ) {}

  onApplicationBootstrap(): void {
    if (!autoClearSessionHistoryEnabled()) {
      this.logger.log('Auto session history cleanup disabled (AUTO_CLEAR_SESSION_HISTORY=false)');
      return;
    }

    const intervalMs = autoClearIntervalMinutes() * 60_000;
    this.logger.log(
      `Auto session history cleanup enabled — every ${autoClearIntervalMinutes()}m, retention ${autoClearMessageRetentionHours()}h`,
    );

    void this.runCleanup('startup');
    this.intervalHandle = setInterval(() => {
      void this.runCleanup('scheduled');
    }, intervalMs);
  }

  onModuleDestroy(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /** Purge messages and finished batches older than the configured retention window. */
  async runCleanup(trigger: 'startup' | 'scheduled' | 'manual' | 'broadcast'): Promise<{
    messagesRemoved: number;
    batchesRemoved: number;
  }> {
    const cutoff = new Date(Date.now() - autoClearMessageRetentionHours() * 60 * 60 * 1000);

    const messageResult = await this.messageRepository.delete({
      createdAt: LessThan(cutoff),
    });

    const batchResult = await this.batchRepository.delete({
      createdAt: LessThan(cutoff),
      status: In([BatchStatus.COMPLETED, BatchStatus.FAILED, BatchStatus.CANCELLED]),
    });

    const messagesRemoved = messageResult.affected ?? 0;
    const batchesRemoved = batchResult.affected ?? 0;

    if (messagesRemoved > 0 || batchesRemoved > 0) {
      this.logger.log(`Session history cleanup (${trigger})`, {
        messagesRemoved,
        batchesRemoved,
        retentionHours: autoClearMessageRetentionHours(),
      });
    }

    return { messagesRemoved, batchesRemoved };
  }

  /** Drop all stored messages for one session (e.g. after automation broadcast). */
  async clearSessionMessages(sessionId: string): Promise<number> {
    const result = await this.messageRepository.delete({ sessionId });
    const removed = result.affected ?? 0;
    if (removed > 0) {
      this.logger.log(`Cleared ${removed} stored message(s) for session ${sessionId}`);
    }
    return removed;
  }

  shouldClearAfterBroadcast(): boolean {
    return autoClearAfterBroadcastEnabled();
  }
}

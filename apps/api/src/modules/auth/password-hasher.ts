import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';

/**
 * Thin seam around argon2id so AuthService stays unit-testable without the
 * native binding (DIP: consumers depend on this contract, not argon2).
 */
@Injectable()
export class PasswordHasher {
  hash(plain: string): Promise<string> {
    return argon2.hash(plain, { type: argon2.argon2id });
  }

  verify(hash: string, plain: string): Promise<boolean> {
    return argon2.verify(hash, plain);
  }
}

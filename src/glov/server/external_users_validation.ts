import { ERR_INVALID_PROVIDER } from 'glov/common/external_users_common';
import { ErrorCallback } from 'glov/common/types';

export interface ValidLoginData {
  provider: string;
  external_id: string;
  extra?: {
    identifier: string;
    platform: string;
    verified: boolean;
  };
}

export interface ExternalUsersValidator {
  getProvider(): string;
  validateLogin(validation_data: string, cb: ErrorCallback<ValidLoginData, string>): void;
}

const setup_validators: Partial<Record<string, ExternalUsersValidator>> = {};

export function externalUsersValidateLogin(
  provider: string,
  validation_data: string,
  cb: ErrorCallback<ValidLoginData, string>,
): void {
  let validator = setup_validators[provider];
  if (validator) {
    validator.validateLogin(validation_data, cb);
  } else {
    cb(ERR_INVALID_PROVIDER);
  }
}

export function externalUsersValidationSetup(validators: ExternalUsersValidator[]): void {
  validators.forEach((validator) => {
    setup_validators[validator.getProvider()] = validator;
  });
}

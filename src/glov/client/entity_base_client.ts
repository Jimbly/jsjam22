// Portions Copyright 2022 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

import assert from 'assert';
import * as engine from 'glov/client/engine';
import {
  ActionDataAssignments,
  ActionMessageParam,
  EntityBaseCommon,
  EntityBaseDataCommon,
} from 'glov/common/entity_base_common';
import { DataObject, NetErrorCallback } from 'glov/common/types';
import {
  ClientEntityManagerInterface,
} from './entity_manager_client';

type DataOverride = {
  field: string;
  field_start: string | undefined;
  field_new: string;
  data: Partial<Record<string, unknown>>;
};

export interface ClientActionMessageParam<Entity extends EntityBaseClient=EntityBaseClient> extends ActionMessageParam {
  ent: Entity;
}

interface BatchUpdateParam extends ActionMessageParam {
  field: string;
}

export class EntityBaseClient extends EntityBaseCommon {
  declare entity_manager: ClientEntityManagerInterface;
  fading_out: boolean;
  fading_in: boolean;
  seq_id: number;
  data_overrides: DataOverride[];
  fade: number | null;
  last_update_timestamp: number;

  constructor(data: EntityBaseDataCommon) {
    super(data);
    this.fade = null;
    this.fading_out = false;
    this.fading_in = false;
    this.data_overrides = [];
    this.seq_id = 0;
    this.last_update_timestamp = engine.frame_timestamp;
  }

  isMe(): boolean {
    return this.id === this.entity_manager.getMyEntID();
  }

  getData<T>(field: string, deflt: T): T;
  getData<T>(field: string): T | undefined;
  getData(field: string, deflt?: unknown): unknown {
    let ret = (this.data as DataObject)[field];
    for (let ii = 0; ii < this.data_overrides.length; ++ii) {
      let override = this.data_overrides[ii];
      let { data } = override;
      let v = data[field];
      if (v !== undefined) {
        if (v === null) {
          ret = undefined;
        } else {
          ret = v;
        }
      }
    }
    return ret ?? deflt;
  }
  setDataOverride(field: string, data: Partial<Record<string, unknown>>): string | undefined {
    let field_start = this.getData<string>(field);
    let sub_id = this.entity_manager.getSubscriptionId();
    let field_new = `${sub_id}:${++this.seq_id}`;
    // Also predict this change
    data[field] = field_new;
    this.data_overrides.push({
      field,
      field_start,
      field_new,
      data,
    });
    return field_start;
  }
  postEntUpdate(): void {
    this.last_update_timestamp = engine.frame_timestamp;
    if (this.data_overrides.length) {
      // Flush all data overrides up to the one who's field_start matches our current values
      let by_field: Partial<Record<string, true>> = {};
      this.data_overrides = this.data_overrides.filter((override) => {
        let { field } = override;
        if (by_field[field]) {
          // already validated
          return true;
        } else if ((this.data as DataObject)[field] === override.field_start) {
          // this, and any following, still need to be applied
          by_field[field] = true;
          return true;
        } else {
          // this has been applied, or failed to apply
          return false;
        }
      });
    }
  }

  actionPrepDataAssignments(
    action_data: ActionMessageParam,
    field: string,
    data_assignments: ActionDataAssignments
  ): void {
    assert(!action_data.data_assignments);
    assert(!action_data.predicate);
    let expected_value = this.setDataOverride(field, data_assignments);
    action_data.predicate = {
      field,
      expected_value,
    };
    if (data_assignments.client_only) {
      action_data.data_assignments = {
        [field]: data_assignments[field],
      };
    } else {
      action_data.data_assignments = data_assignments;
    }
  }

  handleActionResult(action_data: ActionMessageParam, err?: string, data?: unknown): void {
    // If any error, we need to clear all overrides from this point onward, they will all fail
    // Note: we may have already had an update come in that cleared all overrides
    //   and started a new chain from a different ID!
    if (err) {
      let { predicate } = action_data;
      if (predicate) {
        let { field, expected_value } = predicate;
        let walk_id = expected_value;
        this.data_overrides = this.data_overrides.filter((override) => {
          if (override.field === field) {
            if (override.field_start === walk_id) {
              // This is part of the chain stemming from what failed
              walk_id = override.field_new;
              return false;
            }
            // else this must be in a new chain
          }
          return true;
        });
      }
    }
  }

  actionSend<T=unknown>(action: ActionMessageParam, resp_func?: NetErrorCallback<T>): void {
    (action as ClientActionMessageParam).ent = this;
    this.entity_manager.actionSendQueued(action as ClientActionMessageParam,
      resp_func as NetErrorCallback<unknown> | undefined);
  }

  applyBatchUpdate<T=unknown>(update: BatchUpdateParam, resp_func?: NetErrorCallback<T>): void {
    let { field, action_id, payload, data_assignments } = update;
    assert(data_assignments);
    assert(!update.predicate);
    let action_data = {
      action_id,
      payload,
    };
    this.actionPrepDataAssignments(action_data, field, data_assignments);
    this.actionSend(action_data, resp_func);
  }

  hasPendingBatchUpdate(): boolean {
    for (let key in this.data_overrides) {
      return true;
    }
    return false;
  }

  // Expected to be overridden by app
  onDelete(reason: string): number {
    // Returns how many milliseconds to keep the entity around in a fading_out state
    return 250;
  }

  // Expected to be overridden by app
  // Called after full ent update has been applied to the entity
  // is_initial is true if this is part of the initial updates (old entities we're
  //   just seeing now) as opposed to a brand new entity
  onCreate(is_initial: boolean): number {
    // Returns how many milliseconds to keep the entity in a fading_in state
    return is_initial && !this.entity_manager.isReady() ? 0 : 250;
  }

}

export enum FriendStatus {
  Added = 1,
  AddedAuto = 2,
  Removed = 3,
  Blocked = 4,
}

export interface FriendData {
  status: FriendStatus;
  ids?: Record<string, string>;
}

export type FriendsData = Record<string, FriendData>;

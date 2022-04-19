export class ExternalUserInfo {
  external_id: string;
  name?: string;
  profile_picture_url?: string;

  constructor(external_id: string, name?: string, profile_picture_url?: string) {
    this.external_id = external_id;
    this.name = name;
    this.profile_picture_url = profile_picture_url;
  }
}

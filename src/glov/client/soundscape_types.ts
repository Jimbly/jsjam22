import { GlovSound, GlovSoundSetUp } from './sound';

export interface SSDataFile {
  /**
   * Data for file information objects within each layer in SoundScape data.
   *
   * @param file - Sound file path.
   * @param fade_time - (Optional) Time to fade out sound when removed from play.
   * @param excl_group - Key groups in which layer might be played.
   */
  file: string;
  fade_time?: number;
  excl_group: string | string[];
}

export interface SSDataLayerCommon {
  /**
   * Common values that can be passed in any parent or child layer in SoundScape data.
   *
   * @param sync_with - (Optional) Layer with which this should be synced to.
   * @param period - (Optional) Time between recalculating relative intensity of layer.
   * @param min_intensity - (Optional) Minimum intensity in which layer can be played.
   * @param max_intensity - (Optional) Maximum intensity in which layer can be played.
   * @param add_delay - (Optional) Minimum time to wait between adding sounds to layer.
   * @param files - List of possible sounds for layer.
   */
  sync_with?: string;
  period?: number;
  min_intensity?: number;
  max_intensity?: number;
  add_delay?: number;
  files: SSDataFile[];
}

export interface SSDataTagLayer extends SSDataLayerCommon {
  /**
   * Data for tag-specific layers only in SoundScape data.
   *
   * @param priority - Priority between different tags on same layer.
   * @param odds - Chances of different number of sound being played starting at 0 sounds.
   *   e.g.: For [1, 2, 3], there is 1/6 chance of 0 sounds, 2/6 chances of 1 sound,
   *   and 3/6 chances of 2 sounds being played.
   */
  priority: number;
  odds?: number[];
}

export interface SSDataLayerBase extends SSDataLayerCommon {
  /**
   * Data for parent layers only in SoundScape data.
   *
   * @param excl_group_master - Excl. group is forced, instead of stopping previous sounds when mismatched.
   * @param period_noise - Random factor to be added to period on rel_intensity calculation
   * @param tags - Child layers that are tag specific.
   */
  excl_group_master?: boolean;
  period_noise?: number;
  min_intensity: number;
  tags?: Record<string, SSDataTagLayer>;
}
export interface SSDataLayerMax extends SSDataLayerBase {
  /**
   * @param max - Number of maximum tracks for prepared layer odds. Each additional one is reduced in equal parts.
   *   e.g.: For max value of 3, first track has 100%, second one has 66%, third has 33% chance of being played.
   */
  max: number;
}
export interface SSDataLayerOdds extends SSDataLayerBase {
  /**
   * @param odds - Chances of different number of sound being played starting at 0 sounds.
   *   e.g.: For [1, 2, 3], there is 1/6 chance of 0 sounds, 2/6 chances of 1 sound,
   *   and 3/6 chances of 2 sounds being played.
   */
  odds: number[];
}
export type SSDataLayer = SSDataLayerMax | SSDataLayerOdds;

export function dataLayerHasMax(layer: SSDataLayer): layer is SSDataLayerMax {
  return Boolean((layer as SSDataLayerMax).max);
}

export interface SSData {
  /**
   * Object containing all data needed to construct SoundScape instance.
   *
   * @param base_path - Base path from where layer sounds should be loaded.
   * @param default_fade_time - Default time to fade out sounds to be used when not provided per layer.
   * @param layers - All possible layers that can be instanced and added to SoundScape.
   */
  base_path: string;
  default_fade_time: number;
  layers: Record<string, SSDataLayer>;
}


export interface SSFile {
  /**
   * Object containing all data needed to construct SoundScape instance.
   *
   * @param base_path - Base path from where layer sounds should be loaded.
   * @param default_fade_time - Default time to fade out sounds to be used when not provided per layer.
   * @param layers - All possible layers that can be instanced and added to SoundScape.
   */
  file: string;
  fade_time: number;
  excl_group: Record<string, boolean>;
  excl_group_first: string;
  excl_group_debug: string;
  tag_id?: string; // To show which tag a file was chosen from in debug logs
}

export interface SSLayerCommon {
  /**
   * Prepared layer from SSData after being added to SoundScape
   *
   * @param excl_group_master - Excl. group is forced, instead of stopping previous sounds when mismatched.
   * @param sync_with - (Optional) Layer with which this should be synced to.
   * @param odds - Chances of different number of sound being played starting at 0 sounds.
   *   e.g.: For [1, 2, 3], there is 1/6 chance of 0 sounds, 2/6 chances of 1 sound,
   *   and 3/6 chances of 2 sounds being played.
   * @param odds_total - Total value of odds to use as random factor.
   * @param period - (Optional) Time between recalculating relative intensity of layer.
   * @param period_noise - Random factor to be added to period on rel_intensity calculation
   * @param min_intensity - (Optional) Minimum intensity in which layer can be played.
   * @param max_intensity - (Optional) Maximum intensity in which layer can be played.
   * @param add_delay - (Optional) Minimum time to wait between adding sounds to layer.
   * @param files - List of possible sounds for layer.
   * @param files_map - Alternative access to layer files through name indexing.
   */
  excl_group_master?: boolean;
  sync_with?: string;
  odds: number[];
  odds_total: number;
  period: number;
  period_noise: number;
  min_intensity: number;
  max_intensity: number;
  add_delay: number;
  files: SSFile[];
  files_map: Record<string, SSFile>;
}
export interface SSTagLayer extends SSLayerCommon {
  /**
   * @param priority - Priority between different tags on same layer.
   */
  priority: number;
}
export interface SSParentLayer extends SSLayerCommon {
  /**
   * @param tags - Child layers that are tag specific.
   * @param user_idx - Tracks id for each added layer. (Used for sorting)
   */
  tags: Record<string, SSTagLayer>;
  user_idx: number;
}
export type SSLayer = SSParentLayer | SSTagLayer;


export interface SSSoundStateBase {
  /**
   * State of each individual sound within layer. (Can be initialized without reference to sound).
   *
   * @param file - File information for sound.
   * @param start - When sound was last requested to be played or streamed.
   * @param sound - GLOV Sound object being referred to.
   */
  file: SSFile;
  start: number;
  sound?: GlovSound;
}
export interface SSSoundState extends SSSoundStateBase {
  sound: GlovSound;
}

export interface SSLayerState {
  /**
   * State of each individual layer in the Soundscape.
   *
   * @param active - Currently active (or being streamed) sounds.
   * @param rel_intensity - Value used to calculate wanted sounds with layer odds parameter.
   * @param last_add - When a new sound last started playing or being streamed.
   * @param change -  When to change layer relative intensity.
   * @param add_blocked - For debugging: Check if is blocked due to 'add_delay'.
   * @param drained - For debugging: Check if is blocked due to no more available valid files.
   */
  active: SSSoundState[];
  rel_intensity: number;
  last_add: number;
  change: number;
  add_blocked: boolean;
  drained: boolean;
}

export interface SoundScape {
  /**
   * SoundScape for progressively generated music based on individual consecutive sounds.
   *
   * @param data_layers - Loaded layers passed as SoundScape argument in SSData format.
   * @param layers - Prepared layers from data stubs after being added to SoundScape via AddAll or AddLayer.
   * @param base_path - Base path from where layer sounds should be loaded.
   * @param default_fade_time - Default time to fade out sounds to be used when not provided per layer.
   * @param enable_logs - Enable SoundScape debug logs in console.
   * @param streaming - Load each individual sound only when requested during SoundScape tick.
   * @param kill_delay - Value to use as global fade override when stopping whole SoundScape.
   * @param force_no_tracks - Setting to force SoundScape to not request any new sounds.
   * @param fade_in_time - Amount of time in which new sounds should be faded in instead of immediately played.
   * @param fade_in_start - Timestamp in which fade-in time was set (Used for sound starting volume calculations).
   * @param intensity - Value used to know how many sounds per layer and which layers to play.
   * @param tags - Additional sub-layers used in specific contexts manually set in SoundScape.
   * @param streaming_cbs - pending operations per sound to do after they start playing when streamed.
   * @param layer_state - Each individual layer's state.
   * @param layer_keys - Keys for each individual layer.
   * @param timestamp - Time when SoundScape is initialized. (Used for period calculations).
   * @param user_idx - Tracks id for each added layer. (Used for sorting)
   */
  data_layers: Record<string, SSDataLayer>;
  layers: Record<string, SSParentLayer>;
  base_path: string;
  default_fade_time: number;
  enable_logs: boolean;
  streaming: boolean;
  kill_delay: number;

  force_no_tracks: boolean;
  fade_in_time: number;
  fade_in_start: number;
  intensity: number;
  tags: Record<string, boolean>;
  streaming_cbs: Record<string, ((sound: GlovSoundSetUp) => void)[]>;

  layer_state: Record<string, SSLayerState>;
  layer_keys: string[];
  timestamp: number;
  user_idx: number;
}

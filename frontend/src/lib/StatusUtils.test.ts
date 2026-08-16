/*
 * Copyright 2026 The Kubeflow Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { V2beta1RuntimeState } from 'src/apisv2beta1/run';
import { hasFinishedV2 } from './StatusUtils';

describe('StatusUtils', () => {
  describe('hasFinishedV2', () => {
    it('reports terminal states as finished', () => {
      expect(hasFinishedV2(V2beta1RuntimeState.SUCCEEDED)).toBe(true);
      expect(hasFinishedV2(V2beta1RuntimeState.FAILED)).toBe(true);
      expect(hasFinishedV2(V2beta1RuntimeState.SKIPPED)).toBe(true);
      expect(hasFinishedV2(V2beta1RuntimeState.CANCELED)).toBe(true);
    });

    it('reports in-flight states as unfinished', () => {
      expect(hasFinishedV2(V2beta1RuntimeState.PENDING)).toBe(false);
      expect(hasFinishedV2(V2beta1RuntimeState.RUNNING)).toBe(false);
      expect(hasFinishedV2(V2beta1RuntimeState.CANCELING)).toBe(false);
      expect(hasFinishedV2(V2beta1RuntimeState.RUNTIME_STATE_UNSPECIFIED)).toBe(false);
    });

    // The API omits RUNTIME_STATE_UNSPECIFIED, so it arrives as undefined rather than as that case.
    it('does not throw on a missing state', () => {
      expect(() => hasFinishedV2(undefined)).not.toThrow();
      expect(hasFinishedV2(undefined)).toBe(false);
    });

    it('does not throw on an unrecognized state', () => {
      expect(() => hasFinishedV2('SOMETHING_NEW' as V2beta1RuntimeState)).not.toThrow();
      expect(hasFinishedV2('SOMETHING_NEW' as V2beta1RuntimeState)).toBe(false);
    });
  });
});

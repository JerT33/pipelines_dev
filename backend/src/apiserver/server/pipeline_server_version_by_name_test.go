// Copyright 2026 The Kubeflow Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package server

import (
	"context"
	"testing"
	"time"

	apiv2beta1 "github.com/kubeflow/pipelines/backend/api/v2beta1/go_client"
	"github.com/kubeflow/pipelines/backend/src/apiserver/client"
	"github.com/kubeflow/pipelines/backend/src/apiserver/common"
	"github.com/kubeflow/pipelines/backend/src/apiserver/model"
	"github.com/kubeflow/pipelines/backend/src/apiserver/resource"
	"github.com/kubeflow/pipelines/backend/src/common/util"
	"github.com/spf13/viper"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
)

// versionByNameServer returns a server backed by a pipeline that owns one
// version named "v1.0", plus that version's id.
func versionByNameServer(t *testing.T, namespace string, authorized bool) (*PipelineServer, string, string) {
	t.Helper()
	initEnvVars()
	clients, err := resource.NewFakeClientManager(util.NewFakeTime(time.Unix(200, 0)), util.NewUUIDGenerator())
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, clients.Close()) })
	if !authorized {
		clients.SubjectAccessReviewClientFake = client.NewFakeSubjectAccessReviewClientUnauthorized()
	}
	manager := resource.NewResourceManager(clients, &resource.ResourceManagerOptions{CollectMetrics: false})

	pipeline, err := manager.CreatePipeline(&model.Pipeline{Name: "version-by-name", Namespace: namespace})
	require.NoError(t, err)
	version, err := manager.CreatePipelineVersion(&model.PipelineVersion{
		Name: "v1.0", PipelineId: pipeline.UUID, PipelineSpec: model.LargeText(v2SpecHelloWorld),
	})
	require.NoError(t, err)

	return createPipelineServer(manager, nil), pipeline.UUID, version.UUID
}

func TestGetPipelineVersionByName(t *testing.T) {
	server, pipelineID, versionID := versionByNameServer(t, "", true)

	version, err := server.GetPipelineVersionByName(context.Background(),
		&apiv2beta1.GetPipelineVersionByNameRequest{PipelineId: pipelineID, Name: "v1.0"})

	require.NoError(t, err)
	assert.Equal(t, versionID, version.GetPipelineVersionId())
	assert.Equal(t, pipelineID, version.GetPipelineId())
}

func TestGetPipelineVersionByName_EmptyPipelineIdIsRejected(t *testing.T) {
	server, _, _ := versionByNameServer(t, "", true)

	_, err := server.GetPipelineVersionByName(context.Background(),
		&apiv2beta1.GetPipelineVersionByNameRequest{Name: "v1.0"})

	require.Error(t, err)
	assert.Equal(t, codes.InvalidArgument, err.(*util.UserError).ExternalStatusCode())
}

func TestGetPipelineVersionByName_NotFound(t *testing.T) {
	server, pipelineID, _ := versionByNameServer(t, "", true)

	_, err := server.GetPipelineVersionByName(context.Background(),
		&apiv2beta1.GetPipelineVersionByNameRequest{PipelineId: pipelineID, Name: "nonexistent"})

	require.Error(t, err)
	assert.Equal(t, codes.NotFound, err.(*util.UserError).ExternalStatusCode())
}

// The version id is unknown before the lookup, so the request is authorized
// against the parent pipeline's namespace.
func TestGetPipelineVersionByName_MultiUser_UnauthorizedIsDenied(t *testing.T) {
	viper.Set(common.MultiUserMode, "true")
	defer viper.Set(common.MultiUserMode, "false")

	server, pipelineID, _ := versionByNameServer(t, "ns1", false)

	_, err := server.GetPipelineVersionByName(userContext(),
		&apiv2beta1.GetPipelineVersionByNameRequest{PipelineId: pipelineID, Name: "v1.0"})

	require.Error(t, err)
	assert.Equal(t, codes.PermissionDenied, err.(*util.UserError).ExternalStatusCode())
}

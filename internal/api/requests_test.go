package api

import (
	"testing"

	"github.com/mediamtx-control/mediamtx-control/internal/service"
)

func TestStrictPublicSchema(t *testing.T) {
	for _, body := range []string{`{"record":true,"record":false}`, `{"Record":true}`, `{"record":null}`, `{"record":true} {}`, `[]`, `null`, `{"maxReaders":1.5}`, `{"source":{}}`} {
		var patch service.PathPatch
		if err := decodeObject([]byte(body), &patch); err == nil {
			t.Errorf("accepted %s", body)
		}
	}
	var patch service.PathPatch
	if err := decodeObject([]byte(`{"record":false,"maxReaders":0}`), &patch); err != nil || patch.Record == nil || *patch.Record || patch.MaxReaders == nil || *patch.MaxReaders != 0 {
		t.Fatalf("false/zero lost: %+v %v", patch, err)
	}
}

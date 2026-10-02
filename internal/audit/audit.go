package audit

import (
	"context"
	"time"

	"github.com/mediamtx-control/mediamtx-control/internal/store/sqlite"
)

type Logger struct{ Store *sqlite.Store }

// Persist intent before calling the upstream. A crash leaves an inspectable pending
// record; a completion write uses a fresh context even if the caller disconnected.
func (l Logger) Run(ctx context.Context, user, action, resource, ip string, fn func() error) error {
	id, err := l.Store.AddAudit(ctx, sqlite.Audit{User: user, Action: action, Resource: resource, IP: ip, Outcome: "pending"})
	if err != nil {
		return err
	}
	opErr := fn()
	outcome := "success"
	if opErr != nil {
		outcome = "failure"
	}
	finish, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
	defer cancel()
	if err = l.Store.FinishAudit(finish, id, outcome); err != nil {
		return err
	}
	return opErr
}

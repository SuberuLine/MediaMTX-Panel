package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"reflect"
	"strings"
)

// encoding/json intentionally matches struct fields case-insensitively and
// accepts duplicate keys. Enforce exact public schema names before decoding.
func decodeObject(body []byte, dst any) error {
	allowed := map[string]bool{}
	var fields func(reflect.Type)
	fields = func(typ reflect.Type) {
		for i := 0; i < typ.NumField(); i++ {
			f := typ.Field(i)
			if f.Anonymous {
				fields(f.Type)
				continue
			}
			name := strings.Split(f.Tag.Get("json"), ",")[0]
			if name != "" && name != "-" {
				allowed[name] = true
			}
		}
	}
	fields(reflect.TypeOf(dst).Elem())
	d := json.NewDecoder(bytes.NewReader(body))
	token, err := d.Token()
	if err != nil || token != json.Delim('{') {
		return errors.New("object required")
	}
	seen := map[string]bool{}
	for d.More() {
		token, err = d.Token()
		if err != nil {
			return err
		}
		name, ok := token.(string)
		if !ok || !allowed[name] || seen[name] {
			return errors.New("unknown or duplicate field")
		}
		seen[name] = true
		var value json.RawMessage
		if err = d.Decode(&value); err != nil {
			return err
		}
		if bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return errors.New("null is not supported")
		}
	}
	if _, err = d.Token(); err != nil {
		return err
	}
	var extra any
	if err = d.Decode(&extra); !errors.Is(err, io.EOF) {
		return errors.New("single JSON object required")
	}
	return json.Unmarshal(body, dst)
}

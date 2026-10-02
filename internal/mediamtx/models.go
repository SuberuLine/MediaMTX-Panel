// Package mediamtx contains the version-specific Control API adapter. These wire
// types are private to the backend boundary; services expose separate DTOs.
package mediamtx

import "time"

type Info struct {
	Version string    `json:"version"`
	Started time.Time `json:"started"`
}
type Source struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}
type Track struct {
	Codec string `json:"codec"`
}
type Path struct {
	Name    string   `json:"name"`
	Online  *bool    `json:"online"`
	Ready   bool     `json:"ready"`
	Source  *Source  `json:"source"`
	Tracks  []string `json:"tracks"`
	Tracks2 []Track  `json:"tracks2"`
	Readers []Source `json:"readers"`
}
type Connection struct {
	ID            string    `json:"id"`
	Created       time.Time `json:"created"`
	RemoteAddr    string    `json:"remoteAddr"`
	Path          string    `json:"path"`
	State         string    `json:"state"`
	InboundBytes  *uint64   `json:"inboundBytes"`
	OutboundBytes *uint64   `json:"outboundBytes"`
	BytesReceived uint64    `json:"bytesReceived"`
	BytesSent     uint64    `json:"bytesSent"`
}
type PathConfig struct {
	Name                  string `json:"name"`
	Source                string `json:"source"`
	SourceOnDemand        bool   `json:"sourceOnDemand"`
	MaxReaders            int    `json:"maxReaders"`
	Record                bool   `json:"record"`
	RecordFormat          string `json:"recordFormat"`
	RecordSegmentDuration string `json:"recordSegmentDuration"`
	RecordDeleteAfter     string `json:"recordDeleteAfter"`
	OverridePublisher     bool   `json:"overridePublisher"`
}
type PathPatch struct {
	Source                *string `json:"source,omitempty"`
	SourceOnDemand        *bool   `json:"sourceOnDemand,omitempty"`
	MaxReaders            *int    `json:"maxReaders,omitempty"`
	Record                *bool   `json:"record,omitempty"`
	RecordFormat          *string `json:"recordFormat,omitempty"`
	RecordSegmentDuration *string `json:"recordSegmentDuration,omitempty"`
	RecordDeleteAfter     *string `json:"recordDeleteAfter,omitempty"`
	OverridePublisher     *bool   `json:"overridePublisher,omitempty"`
}

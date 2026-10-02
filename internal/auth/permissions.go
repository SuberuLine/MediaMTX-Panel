package auth

// Roles are permission collections. HTTP code depends on permissions, never roles.
var roles = map[string]map[string]bool{
	"admin":    permissions("dashboard.read", "instance.read", "stream.read", "stream.create", "stream.update", "stream.delete", "connection.read", "connection.kick", "recording.read", "recording.delete", "config.read", "config.update", "user.read", "user.manage", "audit.read", "metrics.read"),
	"operator": permissions("dashboard.read", "instance.read", "stream.read", "connection.read", "connection.kick", "recording.read", "recording.delete", "metrics.read"),
	"viewer":   permissions("dashboard.read", "stream.read"),
}

func permissions(names ...string) map[string]bool {
	m := map[string]bool{}
	for _, n := range names {
		m[n] = true
	}
	return m
}
func Allowed(role, permission string) bool { return roles[role][permission] }
func ValidRole(role string) bool           { _, ok := roles[role]; return ok }
func Permissions(role string) []string {
	result := []string{}
	for p := range roles[role] {
		result = append(result, p)
	}
	return result
}

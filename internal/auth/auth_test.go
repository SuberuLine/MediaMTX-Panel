package auth

import "testing"

func TestPasswordHashAndRBAC(t *testing.T) {
	hash, err := HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	if !VerifyPassword(hash, "correct horse battery staple") || VerifyPassword(hash, "wrong password") {
		t.Fatal("password verification failed")
	}
	if VerifyPassword("$argon2id$v=19$m=999999999,t=3,p=2$AA$AA", "password") {
		t.Fatal("accepted unsafe parameters")
	}
	if _, err = HashPassword("short"); err == nil {
		t.Fatal("accepted weak password")
	}
	for _, p := range []string{"stream.create", "stream.update", "stream.delete", "config.read", "config.update", "user.manage"} {
		if Allowed("operator", p) || Allowed("viewer", p) {
			t.Fatalf("overprivileged role for %s", p)
		}
		if !Allowed("admin", p) {
			t.Fatalf("admin missing %s", p)
		}
	}
	if !Allowed("operator", "connection.kick") || Allowed("viewer", "connection.kick") || Allowed("unknown", "stream.read") {
		t.Fatal("invalid role permissions")
	}
}

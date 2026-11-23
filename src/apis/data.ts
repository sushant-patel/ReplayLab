// Synthetic data shared by both API versions, so any v1/v2 difference comes from code.

export type Role = "admin" | "editor" | "viewer";

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  createdAt: string; // fixed, so responses are deterministic
  address: { city: string; country: string };
  tags: string[]; // some empty on purpose (nullEmptyTags)
}

export const users: readonly User[] = [
  { id: 101, name: "Rahul", email: "rahul@example.com", role: "admin", createdAt: "2024-01-15T10:00:00.000Z", address: { city: "Bengaluru", country: "IN" }, tags: ["beta", "billing"] },
  { id: 102, name: "Ananya", email: "ananya@example.com", role: "viewer", createdAt: "2024-02-03T08:30:00.000Z", address: { city: "Pune", country: "IN" }, tags: [] },
  { id: 103, name: "Vikram", email: "vikram@example.com", role: "editor", createdAt: "2024-02-20T12:15:00.000Z", address: { city: "Hyderabad", country: "IN" }, tags: ["content"] },
  { id: 104, name: "Meera", email: "meera@example.com", role: "admin", createdAt: "2024-03-01T09:45:00.000Z", address: { city: "Chennai", country: "IN" }, tags: ["ops", "oncall"] },
  { id: 105, name: "Arjun", email: "arjun@example.com", role: "viewer", createdAt: "2024-03-18T17:00:00.000Z", address: { city: "Delhi", country: "IN" }, tags: [] },
  { id: 106, name: "Sara", email: "sara@example.com", role: "editor", createdAt: "2024-04-02T11:20:00.000Z", address: { city: "Seattle", country: "US" }, tags: ["beta"] },
  { id: 107, name: "Kabir", email: "kabir@example.com", role: "viewer", createdAt: "2024-04-25T14:05:00.000Z", address: { city: "Mumbai", country: "IN" }, tags: ["trial"] },
  { id: 108, name: "Liam", email: "liam@example.com", role: "editor", createdAt: "2024-05-09T07:50:00.000Z", address: { city: "Dublin", country: "IE" }, tags: [] },
  { id: 109, name: "Isha", email: "isha@example.com", role: "admin", createdAt: "2024-05-30T16:40:00.000Z", address: { city: "Kolkata", country: "IN" }, tags: ["security"] },
  { id: 110, name: "Noah", email: "noah@example.com", role: "viewer", createdAt: "2024-06-12T10:10:00.000Z", address: { city: "Toronto", country: "CA" }, tags: ["beta", "mobile"] },
];

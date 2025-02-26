import { createClient } from '@supabase/supabase-js';

const supabaseUrl = "https://bgsmqjrdryafvlyxywud.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJnc21xanJkcnlhZnZseXh5d3VkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzk5MDk1MDIsImV4cCI6MjA1NTQ4NTUwMn0._WHWk0csFD5k0PsVtT0nGuvgrgKlx7INGMcWzF2zyZ0";
console.log("🔍 SUPABASE_URL:", supabaseUrl);
const supabase = createClient(supabaseUrl, supabaseAnonKey);

const iconCalendar = new Proxy({"src":"/_astro/icon-calendar-dark.CIERjYjX.png","width":105,"height":110,"format":"png"}, {
						get(target, name, receiver) {
							if (name === 'clone') {
								return structuredClone(target);
							}
							if (name === 'fsPath') {
								return "/Users/sebastianschuchhardt/Documents/Code/aitickets/src/images/icon-calendar-dark.png";
							}
							
							return target[name];
						}
					});

const iconLocation = new Proxy({"src":"/_astro/icon-pin-dark.jp5q-vbA.png","width":102,"height":100,"format":"png"}, {
						get(target, name, receiver) {
							if (name === 'clone') {
								return structuredClone(target);
							}
							if (name === 'fsPath') {
								return "/Users/sebastianschuchhardt/Documents/Code/aitickets/src/images/icon-pin-dark.png";
							}
							
							return target[name];
						}
					});

export { iconCalendar as a, iconLocation as i, supabase as s };

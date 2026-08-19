import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--list") || args.length === 0) {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });
    console.log("\n--- Current Users in Database ---");
    if (users.length === 0) {
      console.log("No users found in database.");
    } else {
      console.table(users);
    }
    console.log("\nUsage instructions:");
    console.log("  Update by Email:");
    console.log("    npx tsx scripts/update-user.ts --current-email <currentEmail> --new-email <newEmail> --password <newPassword>");
    console.log("  Update First/Admin User directly:");
    console.log("    npx tsx scripts/update-user.ts --new-email <newEmail> --password <newPassword>");
    console.log("  List users:");
    console.log("    npx tsx scripts/update-user.ts --list\n");
    return;
  }

  let currentEmail = "";
  let newEmail = "";
  let password = "";
  let name = "";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--current-email" && args[i + 1]) {
      currentEmail = args[++i].toLowerCase().trim();
    } else if (args[i] === "--new-email" && args[i + 1]) {
      newEmail = args[++i].toLowerCase().trim();
    } else if (args[i] === "--password" && args[i + 1]) {
      password = args[++i];
    } else if (args[i] === "--name" && args[i + 1]) {
      name = args[++i];
    }
  }

  let targetUser = null;
  if (currentEmail) {
    targetUser = await prisma.user.findUnique({ where: { email: currentEmail } });
    if (!targetUser) {
      console.error(`❌ User with email "${currentEmail}" not found.`);
      process.exit(1);
    }
  } else {
    // Pick the first user
    targetUser = await prisma.user.findFirst();
    if (!targetUser) {
      console.error("❌ No users found in the database to update.");
      process.exit(1);
    }
  }

  const updateData: { email?: string; passwordHash?: string; name?: string } = {};

  if (newEmail && newEmail !== targetUser.email) {
    const existing = await prisma.user.findUnique({ where: { email: newEmail } });
    if (existing && existing.id !== targetUser.id) {
      console.error(`❌ Cannot update email: "${newEmail}" is already used by another user.`);
      process.exit(1);
    }
    updateData.email = newEmail;
  }

  if (password) {
    if (password.length < 6) {
      console.error("❌ Password must be at least 6 characters long.");
      process.exit(1);
    }
    updateData.passwordHash = await hash(password, 12);
  }

  if (name) {
    updateData.name = name;
  }

  if (Object.keys(updateData).length === 0) {
    console.log("⚠️ No changes specified. Use --new-email or --password.");
    return;
  }

  const updated = await prisma.user.update({
    where: { id: targetUser.id },
    data: updateData,
    select: { id: true, email: true, name: true, role: true },
  });

  console.log("✅ User updated successfully!");
  console.log(updated);
  if (password) {
    console.log("🔑 Password has been updated and hashed with bcrypt.");
  }
}

main()
  .catch((e) => {
    console.error("❌ Error updating user:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

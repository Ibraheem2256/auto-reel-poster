import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = "admin@example.com";
  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    const user = await prisma.user.create({
      data: {
        email,
        name: "Admin",
        passwordHash: await hash("admin123456", 12),
        role: "ADMIN",
      },
    });
    await prisma.workspace.create({
      data: {
        ownerId: user.id,
        captions: { default: "", useSameEverywhere: true, platforms: {} },
        hashtags: { default: [], platforms: {} },
      },
    });
    console.log("Seeded admin user: admin@example.com / admin123456");
  } else {
    console.log("Admin user already exists.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
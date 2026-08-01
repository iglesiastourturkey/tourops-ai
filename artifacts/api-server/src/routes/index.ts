import { Router, type IRouter } from "express";
import healthRouter from "./health";
import storageRouter from "./storage";
import profilesRouter from "./profiles";
import customersRouter from "./customers";
import suppliersRouter from "./suppliers";
import toursRouter from "./tours";
import quotationsRouter from "./quotations";
import operationsRouter from "./operations";
import notificationsRouter from "./notifications";
import settingsRouter from "./settings";
import dashboardRouter from "./dashboard";
import aiRouter from "./ai";

const router: IRouter = Router();

router.use(healthRouter);
router.use(storageRouter);
router.use("/profiles", profilesRouter);
router.use("/customers", customersRouter);
router.use("/suppliers", suppliersRouter);
router.use("/tours", toursRouter);
router.use("/quotations", quotationsRouter);
router.use("/operations", operationsRouter);
router.use("/notifications", notificationsRouter);
router.use(settingsRouter);
router.use("/dashboard", dashboardRouter);
router.use("/ai", aiRouter);

export default router;

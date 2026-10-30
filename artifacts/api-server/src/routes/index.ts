import { Router, type IRouter } from "express";
import agonRouter from "./agon";
import healthRouter from "./health";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/agon", agonRouter);

export default router;
